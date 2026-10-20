"use client";

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { Map as LibreMap } from "maplibre-gl";
import { freshness, type LiveRun } from "@rails/domain";

interface Station { tiploc: string; crs: string; name: string; lon: number; lat: number }

interface Props {
  runs: LiveRun[];
  now: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  follow: boolean;
  showStations: boolean;
  zoomAction: {type: "in" | "out" | "reset"; key: number} | null;
}

const GB_BOUNDS: [[number, number], [number, number]] = [[-7.6, 49.9], [1.8, 58.7]];
const FIT = {padding: {top: 70, bottom: 60, left: 50, right: 70}};

/** Color por retraso; se resuelve en el GPU con estilo dirigido por datos. */
const TRAIN_COLOR: maplibregl.ExpressionSpecification = [
  "case",
  [">=", ["coalesce", ["get", "delay"], 0], 600], "#ff8073",
  [">", ["coalesce", ["get", "delay"], 0], 0], "#f4c76a",
  "#91edb4"
];

function toFeatures(runs: LiveRun[], now: number) {
  return {
    type: "FeatureCollection" as const,
    features: runs.filter(run => run.coordinate).map(run => ({
      type: "Feature" as const,
      id: run.version,
      properties: {runId: run.runId, code: run.providerRunId, delay: run.delaySeconds ?? 0, stale: freshness(run.observedAt, now) === "stale"},
      geometry: {type: "Point" as const, coordinates: run.coordinate as [number, number]}
    }))
  };
}

/**
 * Una capa WebGL en lugar de un marcador DOM por tren: el feed nacional entrega
 * miles de circulaciones y el DOM no sostiene ese volumen.
 */
export default function RailMap({runs, now, selectedId, onSelect, follow, showStations, zoomAction}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LibreMap | null>(null);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stations, setStations] = useState<Station[]>([]);

  useEffect(() => {
    fetch("/api/stations").then(response => response.json())
      .then(data => setStations(data.stations as Station[]))
      .catch(() => { /* el mapa funciona sin la capa de contexto */ });
  }, []);

  useEffect(() => {
    if (!container.current) return;
    let map: LibreMap;
    try {
      maplibregl.setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).toString());
      map = new maplibregl.Map({
        container: container.current, center: [-2.6, 54.2], zoom: 5,
        minZoom: 4, maxZoom: 15, attributionControl: false, dragRotate: false, pitchWithRotate: false, touchPitch: false,
        style: {
          version: 8,
          sources: {basemap: {type: "vector", url: "https://tiles.openfreemap.org/planet", attribution: '<a href="https://openfreemap.org/">OpenFreeMap</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}},
          layers: [
            {id: "background", type: "background", paint: {"background-color": "#182320"}},
            {id: "landcover", type: "fill", source: "basemap", "source-layer": "landcover", paint: {"fill-color": "#26372b", "fill-opacity": 0.25}},
            {id: "water", type: "fill", source: "basemap", "source-layer": "water", paint: {"fill-color": "#0e191c"}},
            {id: "waterway", type: "line", source: "basemap", "source-layer": "waterway", paint: {"line-color": "#2a4141", "line-width": 0.7, "line-opacity": 0.55}},
            {id: "boundaries", type: "line", source: "basemap", "source-layer": "boundary", paint: {"line-color": "#48614e", "line-width": 0.7, "line-opacity": 0.4, "line-dasharray": [3, 3]}},
            {id: "roads", type: "line", source: "basemap", "source-layer": "transportation", paint: {"line-color": "#5b7560", "line-width": 0.6, "line-opacity": 0.14}}
          ]
        }
      });
    } catch {
      setError("El navegador no pudo iniciar el mapa WebGL. La lista y el inspector siguen disponibles.");
      return;
    }
    mapRef.current = map;
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.AttributionControl({compact: true}), "bottom-left");
    map.on("error", event => { if (event.error) setError("Mapa base no disponible. Los trenes siguen dibujándose sobre el fondo oscuro."); });

    map.on("style.load", () => {
      map.addSource("stations", {type: "geojson", data: {type: "FeatureCollection", features: []}});
      map.addLayer({id: "station-dot", type: "circle", source: "stations",
        paint: {"circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 1.2, 12, 3], "circle-color": "#6f8f7a", "circle-opacity": 0.55}});

      map.addSource("trains", {type: "geojson", data: {type: "FeatureCollection", features: []}});
      map.addLayer({id: "train-halo", type: "circle", source: "trains",
        paint: {"circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 6, 12, 14], "circle-color": TRAIN_COLOR, "circle-opacity": 0.14}});
      map.addLayer({id: "train-dot", type: "circle", source: "trains",
        paint: {"circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 2.6, 12, 6],
                "circle-color": TRAIN_COLOR, "circle-stroke-width": 0.6, "circle-stroke-color": "#0c1512",
                // Sin señal reciente: se muestra, atenuada, en vez de desaparecer sin aviso.
                "circle-opacity": ["case", ["get", "stale"], 0.35, 1]}});
      map.addLayer({id: "train-selected", type: "circle", source: "trains", filter: ["==", ["get", "runId"], ""],
        paint: {"circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 7, 12, 15], "circle-color": "rgba(0,0,0,0)",
                "circle-stroke-width": 1.8, "circle-stroke-color": "#d8fbe4"}});

      map.on("click", "train-dot", event => {
        const feature = event.features?.[0];
        if (feature) selectRef.current(String(feature.properties?.runId));
      });
      map.on("mouseenter", "train-dot", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "train-dot", () => { map.getCanvas().style.cursor = ""; });

      map.fitBounds(GB_BOUNDS, {...FIT, duration: 0});
      setReady(true);
    });

    const resize = new ResizeObserver(() => map.resize());
    resize.observe(container.current);
    return () => { resize.disconnect(); map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource("trains") as maplibregl.GeoJSONSource | undefined)?.setData(toFeatures(runs, now));
  }, [ready, runs, now]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource("stations") as maplibregl.GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: stations.map(station => ({
        type: "Feature", properties: {name: station.name},
        geometry: {type: "Point", coordinates: [station.lon, station.lat]}
      }))
    });
  }, [ready, stations]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.setFilter("train-selected", ["==", ["get", "runId"], selectedId ?? ""]);
    if (!follow || !selectedId) return;
    const selected = runs.find(run => run.runId === selectedId);
    if (selected?.coordinate) map.easeTo({center: selected.coordinate, zoom: Math.max(map.getZoom(), 9), duration: 700});
  }, [ready, selectedId, follow, runs]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.setLayoutProperty("station-dot", "visibility", showStations ? "visible" : "none");
  }, [showStations, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !zoomAction) return;
    if (zoomAction.type === "in") map.zoomIn();
    else if (zoomAction.type === "out") map.zoomOut();
    else map.fitBounds(GB_BOUNDS, {...FIT, duration: 700});
  }, [zoomAction, ready]);

  return <><div ref={container} className="map-canvas" role="region" aria-label="Mapa de circulaciones en vivo" />{error && <div className="map-error" role="status">{error}</div>}</>;
}
