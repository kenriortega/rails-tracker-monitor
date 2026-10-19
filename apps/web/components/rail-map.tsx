"use client";

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { Map as LibreMap, Marker } from "maplibre-gl";
import { routes, trainCoordinate, trainColor, type DemoTrain } from "@rails/domain";

interface Props {
  trains: DemoTrain[]; seconds: number; selectedId: string | null;
  onSelect: (id: string) => void; follow: boolean; showStations: boolean;
  zoomAction: {type: "in" | "out" | "reset"; key: number} | null;
}

export default function RailMap({trains, seconds, selectedId, onSelect, follow, showStations, zoomAction}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LibreMap | null>(null);
  const trainMarkers = useRef(new Map<string, {marker: Marker; button: HTMLButtonElement}>());
  const stationMarkers = useRef<Marker[]>([]);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!container.current) return;
    let map: LibreMap;
    try {
      maplibregl.setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).toString());
      map = new maplibregl.Map({
        container: container.current, center: [-1.6, 52.3], zoom: 6,
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
    map.on("error", event => {
      if (event.error) setError("Mapa base no disponible. Se muestran únicamente los trazados esquemáticos de la demo.");
    });
    map.on("style.load", () => {
      map.addSource("routes", {type: "geojson", data: {
        type: "FeatureCollection", features: routes.map(route => ({type: "Feature", properties: {id: route.id, color: route.color}, geometry: {type: "LineString", coordinates: route.stations.map(station => station.coordinate)}}))
      }});
      map.addLayer({id: "route-glow", type: "line", source: "routes", paint: {"line-color": ["get", "color"], "line-width": 10, "line-opacity": 0.07, "line-blur": 4}});
      map.addLayer({id: "route-line", type: "line", source: "routes", layout: {"line-join": "round", "line-cap": "round"}, paint: {"line-color": ["get", "color"], "line-width": 1.7, "line-opacity": 0.6}});
      map.addLayer({id: "route-selected", type: "line", source: "routes", filter: ["==", "id", ""], layout: {"line-join": "round"}, paint: {"line-color": "#d8fbe4", "line-width": 2.5, "line-opacity": 0.9}});
      const stations = new Map(routes.flatMap(route => route.stations).map(station => [station.id, station]));
      for (const station of stations.values()) {
        const element = document.createElement("div");
        element.className = "station-marker";
        const dot = document.createElement("i");
        const label = document.createElement("span");
        label.textContent = station.name.replace("London ", "");
        element.append(dot, label);
        const marker = new maplibregl.Marker({element, anchor: "left"}).setLngLat(station.coordinate).addTo(map);
        stationMarkers.current.push(marker);
      }
      map.fitBounds([[-2.8, 51.30], [-0.02, 53.65]], {padding: {top: 80, bottom: 60, left: 50, right: 80}, duration: 0});
      setReady(true);
    });
    const resize = new ResizeObserver(() => map.resize());
    resize.observe(container.current);
    return () => {
      resize.disconnect();
      trainMarkers.current.forEach(({marker}) => marker.remove());
      trainMarkers.current.clear();
      stationMarkers.current.forEach(marker => marker.remove());
      stationMarkers.current = [];
      map.remove(); mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const visible = new Set(trains.map(train => train.id));
    trainMarkers.current.forEach(({marker}, id) => {
      if (!visible.has(id)) {marker.remove(); trainMarkers.current.delete(id);}
    });
    for (const train of trains) {
      const route = routes.find(route => route.id === train.routeId)!;
      const point = trainCoordinate(train, route, seconds);
      if (!point) continue;
      let entry = trainMarkers.current.get(train.id);
      if (!entry) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "train-marker";
        button.setAttribute("aria-label", `Seleccionar tren ${train.headcode}`);
        const icon = document.createElement("span"); icon.className = "train-marker-dot";
        const label = document.createElement("span"); label.className = "train-marker-code"; label.textContent = train.headcode;
        button.append(icon, label);
        button.addEventListener("click", () => selectRef.current(train.id));
        entry = {button, marker: new maplibregl.Marker({element: button, anchor: "left"}).setLngLat(point).addTo(map)};
        trainMarkers.current.set(train.id, entry);
      }
      entry.marker.setLngLat(point);
      entry.button.style.setProperty("--train-color", trainColor(train));
      entry.button.classList.toggle("selected", train.id === selectedId);
      entry.button.setAttribute("aria-pressed", String(train.id === selectedId));
    }
    const selected = trains.find(train => train.id === selectedId);
    map.setFilter("route-selected", ["==", "id", selected?.routeId ?? ""]);
    if (follow && selected) {
      const point = trainCoordinate(selected, routes.find(route => route.id === selected.routeId)!, seconds);
      if (point) map.easeTo({center: point, zoom: Math.max(map.getZoom(), 8), duration: 700});
    }
  }, [ready, trains, seconds, selectedId, follow]);

  useEffect(() => {
    stationMarkers.current.forEach(marker => {marker.getElement().style.visibility = showStations ? "visible" : "hidden";});
  }, [showStations, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !zoomAction) return;
    if (zoomAction.type === "in") map.zoomIn();
    else if (zoomAction.type === "out") map.zoomOut();
    else map.fitBounds([[-2.8, 51.30], [-0.02, 53.65]], {padding: {top: 80, bottom: 60, left: 50, right: 80}, duration: 700});
  }, [zoomAction, ready]);

  return <><div ref={container} className="map-canvas" role="region" aria-label="Mapa ferroviario interactivo de demostración" />{error && <div className="map-error" role="status">{error}</div>}</>;
}
