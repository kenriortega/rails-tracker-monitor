"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, Check, Clock3, Crosshair, Database, Focus, Layers3, MapPin, Minus, Plus, Radio, RotateCcw, Search, Settings2, TrainFront, X } from "lucide-react";
import { freshness, type LiveRun, type Trail } from "@rails/domain";
import { useLiveRuns, type ConnectionState } from "@/lib/use-live-runs";
import { useTrail } from "@/lib/use-trail";

const RailMap = dynamic(() => import("./rail-map"), {ssr: false, loading: () => <div className="map-loading"><Radio size={26}/><span>Preparando el mapa de operaciones…</span></div>});

// El feed nacional entrega miles de circulaciones; el mapa las muestra todas y
// la lista se recorta, porque pintarlas en el DOM no añade información.
const LIST_LIMIT = 120;

type Filter = "all" | "delayed" | "early";

const hhmm = new Intl.DateTimeFormat("es-ES", {timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false});
const hhmmss = new Intl.DateTimeFormat("es-ES", {hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false});

function delayLabel(seconds: number | null): string {
  if (seconds === null) return "Sin dato";
  if (seconds === 0) return "En hora";
  const minutes = Math.max(1, Math.round(Math.abs(seconds) / 60));
  return seconds > 0 ? `+${minutes} min` : `−${minutes} min`;
}

const delayTone = (seconds: number | null) => seconds === null ? "" : seconds >= 600 ? "late" : seconds > 0 ? "amber" : "green";

const CONNECTION: Record<ConnectionState, string> = {
  connecting: "Conectando", live: "En vivo", reconnecting: "Reconectando", failed: "Sin conexión"
};

export function Monitor() {
  const {runs, connection, updatedAt, now} = useLiveRuns();
  const [selectedId, setSelectedIdState] = useState<string | null>(null);
  // La versión de la circulación seleccionada: el recorrido solo se recarga
  // cuando ese tren se mueve, no con cada delta del feed.
  const selectedVersion = runs.find(run => run.runId === selectedId)?.version ?? 0;
  const trail = useTrail(selectedId, selectedVersion);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [operator, setOperator] = useState("all");
  const selectedRowRef = useRef<HTMLLIElement>(null);
  // Solo al cambiar de selección: hacerlo en cada actualización sería un salto
  // constante bajo el cursor.
  useEffect(() => { selectedRowRef.current?.scrollIntoView({block: "nearest"}); }, [selectedId]);
  const setSelectedId = setSelectedIdState;
  const [follow, setFollow] = useState(false);
  const [showStations, setShowStations] = useState(true);
  const [showSources, setShowSources] = useState(false);
  const [zoomAction, setZoomAction] = useState<{type: "in" | "out" | "reset"; key: number} | null>(null);

  const operators = useMemo(
    () => [...new Set(runs.map(run => run.tocId).filter((toc): toc is string => Boolean(toc)))].sort(),
    [runs]
  );

  const matching = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return runs.filter(run => {
      if (needle && !`${run.headcode ?? ""} ${run.providerRunId}`.toLowerCase().includes(needle)) return false;
      if (operator !== "all" && run.tocId !== operator) return false;
      if (filter === "delayed") return (run.delaySeconds ?? 0) > 0;
      if (filter === "early") return (run.delaySeconds ?? 0) < 0;
      return true;
      // Orden estable por identidad, no por hora del último reporte: ordenar por
      // hora rebarajaba la lista entera cada pocos segundos y el tren que
      // estabas mirando se escapaba de la vista.
    }).sort((a, b) => (a.headcode ?? a.providerRunId).localeCompare(b.headcode ?? b.providerRunId)
                   || a.providerRunId.localeCompare(b.providerRunId));
  }, [runs, query, filter, operator]);

  const positioned = useMemo(() => matching.filter(run => run.coordinate), [matching]);
  const unpositioned = useMemo(() => matching.filter(run => !run.coordinate), [matching]);

  /** Recorta la lista, pero nunca deja fuera la circulación seleccionada. */
  const visible = (list: LiveRun[]) => {
    const shown = list.slice(0, LIST_LIMIT);
    const selectedRun = list.find(run => run.runId === selectedId);
    return selectedRun && !shown.includes(selectedRun) ? [selectedRun, ...shown] : shown;
  };
  const selected = matching.find(run => run.runId === selectedId) ?? null;
  const delayed = runs.filter(run => (run.delaySeconds ?? 0) > 0).length;
  const onTime = runs.filter(run => run.delaySeconds === 0).length;
  const withoutPosition = runs.filter(run => !run.coordinate).length;
  const stale = runs.filter(run => freshness(run.observedAt, now) === "stale").length;
  const percent = (value: number) => runs.length ? value / runs.length * 100 : 0;
  const zoom = (type: "in" | "out" | "reset") => {setFollow(false); setZoomAction({type, key: Date.now()});};

  const row = (run: LiveRun) => (
    <li key={run.runId} ref={run.runId === selectedId ? selectedRowRef : undefined}>
      <button type="button" className={`train-row ${run.runId === selectedId ? "selected" : ""} ${freshness(run.observedAt, now) === "stale" ? "stale" : ""}`} onClick={() => setSelectedId(run.runId)} aria-pressed={run.runId === selectedId}>
        <div className="train-row-top">
          <span className="service-code mono">{run.headcode ?? run.providerRunId}</span>
          <span className={`delay-tag ${delayTone(run.delaySeconds)}`}>{delayLabel(run.delaySeconds)}</span>
        </div>
        <div className="train-row-bottom">
          <span>{freshness(run.observedAt, now) === "stale" ? "Sin señal reciente" : `Operador ${run.tocId ?? "—"}`}</span>
          <span className="mono">{hhmm.format(new Date(run.observedAt))}</span>
        </div>
      </button>
    </li>
  );

  return (
    <div className="app-shell">
      <nav className="icon-rail" aria-label="Navegación">
        <span className="brand-symbol"><TrainFront size={17}/></span>
        <div className="rail-links">
          <button type="button" className="rail-button active" aria-label="Mapa" aria-current="page"><MapPin size={17}/></button>
          <button type="button" className="rail-button" onClick={() => setShowSources(true)} aria-label="Fuentes y límites"><Database size={17}/></button>
        </div>
        <div className="rail-bottom"><Activity size={16}/></div>
      </nav>

      <div className="workspace">
        <header className="topbar">
          <div className="wordmark"><strong>Rails Tracker<i className="wordmark-dot">.</i></strong><small className="wordmark-sub">NETWORK RAIL · MOVEMENT</small></div>
          <div className="header-right">
            <span className="header-context"><i className={`status-dot ${connection === "live" ? "" : "amber"}`}/>{CONNECTION[connection]}</span>
            <span className="header-date">{updatedAt ? `Último cambio ${hhmmss.format(updatedAt)}` : "Cargando…"}</span>
            <span className="demo-badge">DATOS REALES · COBERTURA PARCIAL</span>
          </div>
        </header>

        <section className="overview">
          <div className="overview-heading">
            <span className="eyebrow">CENTRO DE OPERACIONES</span>
            <h1>Circulaciones <span>en vivo</span></h1>
            <p>Reportes de paso de TRUST sobre ubicaciones conocidas. No es GPS ni posición continua.</p>
          </div>
          <div className="metric"><span>Circulaciones <TrainFront/></span><div>{runs.length}</div><div className="mini-bar"><i style={{width: "100%"}}/></div></div>
          <div className="metric"><span>En hora <Check/></span><div>{onTime}<small className="positive">sin desviación</small></div><div className="mini-bar"><i style={{width: `${percent(onTime)}%`}}/></div></div>
          <div className="metric"><span>Con retraso <Clock3/></span><div>{delayed}<small className="amber">por detrás</small></div><div className="mini-bar"><i style={{width: `${percent(delayed)}%`}}/></div></div>
          <div className="metric"><span>Sin posición <MapPin/></span><div>{withoutPosition}<small>no resuelta</small></div><div className="mini-bar"><i style={{width: `${percent(withoutPosition)}%`}}/></div></div>
        </section>

        <section className="operations">
          <aside className="fleet-panel">
            <div className="panel-heading"><h2>Circulaciones</h2><span className="count-tag">{matching.length}</span></div>
            <label className="search-field"><Search size={14}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar headcode o identificador" aria-label="Buscar circulación"/></label>
            <div className="filter-tabs" role="group" aria-label="Filtrar circulaciones">
              <button type="button" className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>Todas</button>
              <button type="button" className={filter === "delayed" ? "active" : ""} onClick={() => setFilter("delayed")}>Con retraso</button>
              <button type="button" className={filter === "early" ? "active" : ""} onClick={() => setFilter("early")}>Adelantadas</button>
            </div>
            <label className="operator-filter"><Settings2 size={13}/>
              <select aria-label="Filtrar por operador" value={operator} onChange={event => setOperator(event.target.value)}>
                <option value="all">Todos los operadores</option>
                {operators.map(toc => <option key={toc} value={toc}>Operador {toc}</option>)}
              </select>
            </label>
            <ul className="fleet-list">
              {visible(positioned).map(row)}
              {positioned.length > LIST_LIMIT && <li className="group-note">y {positioned.length - LIST_LIMIT} más en el mapa</li>}
              {Boolean(unpositioned.length) && <li className="group-heading">Sin posición <span className="count-tag">{unpositioned.length}</span><small>no aparecen en el mapa</small></li>}
              {visible(unpositioned).map(row)}
              {unpositioned.length > LIST_LIMIT && <li className="group-note">y {unpositioned.length - LIST_LIMIT} más sin posición</li>}
              {!matching.length && <li className="empty-state"><span>{runs.length ? "Ninguna circulación coincide con el filtro." : "Esperando datos del feed."}</span></li>}
            </ul>
            <div className="fleet-footer">En el mapa {positioned.length}<span className="mono">{hhmm.format(new Date())} BST</span></div>
          </aside>

          <section className="map-panel">
            <div className="map-canvas"><RailMap runs={positioned} now={now} trail={trail} selectedId={selectedId} onSelect={setSelectedId} follow={follow} showStations={showStations} zoomAction={zoomAction}/></div>
            <div className="map-grid"/>
            <div className="map-top">
              <span className="map-title">POSICIONES REPORTADAS<span className="map-region">GRAN BRETAÑA</span></span>
            </div>
            <div className="map-controls">
              <button type="button" onClick={() => zoom("in")} aria-label="Acercar"><Plus size={14}/></button>
              <button type="button" onClick={() => zoom("out")} aria-label="Alejar"><Minus size={14}/></button>
              <button type="button" onClick={() => zoom("reset")} aria-label="Vista completa"><RotateCcw size={14}/></button>
              <button type="button" className={showStations ? "active" : ""} onClick={() => setShowStations(value => !value)} aria-pressed={showStations} aria-label="Capa de estaciones"><Layers3 size={14}/></button>
              <button type="button" className={follow ? "active" : ""} onClick={() => setFollow(value => !value)} aria-pressed={follow} aria-label="Seguir selección"><Crosshair size={14}/></button>
            </div>
            <p className="map-disclaimer">ÚLTIMA UBICACIÓN REPORTADA · RESOLUCIÓN DE UN MINUTO · NO ES GPS</p>
          </section>

          <aside className="inspector">
            {selected ? <Inspector run={selected} now={now} trail={trail} follow={follow} onFollow={() => setFollow(value => !value)} onClose={() => setSelectedId(null)}/>
              : <div className="inspector-empty"><Activity size={22}/><h2>Sin selección</h2><p>Elige una circulación en la lista o toca un punto del mapa.</p></div>}
          </aside>
        </section>

        <footer className="statusbar">
          <span><i className="status-dot"/>Network Rail MOVEMENT · NaPTAN del Department for Transport · Open Government Licence v3.0</span>
          <span>{positioned.length} en el mapa · {unpositioned.length} sin posición · {stale} sin señal reciente</span>
        </footer>
      </div>

      {showSources && (
        <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-label="Fuentes y límites" onClick={() => setShowSources(false)}>
          <div className="info-dialog" onClick={event => event.stopPropagation()}>
            <button type="button" className="dialog-close" onClick={() => setShowSources(false)} aria-label="Cerrar"><X size={16}/></button>
            <h2>Fuentes y límites</h2>
            <div className="source-list">
              <div><Radio size={18}/><div><strong>MOVEMENT de Network Rail</strong><span>Reportes de paso por ubicaciones. No es posición continua ni GPS.</span></div></div>
              <div><Clock3 size={18}/><div><strong>Resolución de un minuto</strong><span>Las marcas de tiempo no traen segundos. Cerca de un tercio llega con hora posterior a su propia recepción.</span></div></div>
              <div><MapPin size={18}/><div><strong>Cobertura parcial</strong><span>Las coordenadas vienen de NaPTAN, que solo cubre estaciones. Cruces, bucles y señales quedan sin posición.</span></div></div>
              <div><Database size={18}/><div><strong>Sin horario</strong><span>No hay origen, destino ni headcode: exigirían importar y resolver SCHEDULE.</span></div></div>
            </div>
            <p className="small-note">Proyecto experimental sin afiliación con Network Rail. No usar para decisiones operativas o de viaje.</p>
          </div>
        </div>
      )}
    </div>
  );
}

function Inspector({run, now, trail, follow, onFollow, onClose}: {run: LiveRun; now: number; trail: Trail | null; follow: boolean; onFollow: () => void; onClose: () => void}) {
  const state = freshness(run.observedAt, now);
  return (
    <>
      <div className="inspector-heading">
        <span className="eyebrow">CIRCULACIÓN</span>
        <button type="button" onClick={onClose} aria-label="Cerrar inspector"><X size={15}/></button>
      </div>
      <div className="train-detail-title">
        <span className="detail-train-icon"><TrainFront size={19}/></span>
        <div><h2>{run.headcode ?? "—"}</h2><p className="mono">{run.providerRunId}</p><p>Operador {run.tocId ?? "—"} · {run.serviceDate}</p></div>
      </div>
      <div className="detail-status">
        <span className={`delay-tag ${delayTone(run.delaySeconds)}`}>{delayLabel(run.delaySeconds)}</span>
        <span className="count-tag">{run.status === "terminated" ? "TERMINADO" : "EN CURSO"}</span>
      </div>
      <div className="detail-divider"/>
      <div className="detail-section-title"><h3>Última posición</h3><span>{state === "stale" ? "SIN SEÑAL RECIENTE" : run.quality === "reported" ? "REPORTADA" : "SIN RESOLVER"}</span></div>
      <dl className="detail-journey">
        <div><dt>Coordenada</dt><dd className="mono">{run.coordinate ? `${run.coordinate[1].toFixed(4)}, ${run.coordinate[0].toFixed(4)}` : "—"}</dd></div>
        <div><dt>Observado</dt><dd className="mono">{hhmm.format(new Date(run.observedAt))} BST</dd></div>
        <div><dt>Fecha de servicio</dt><dd className="mono">{run.serviceDate}</dd></div>
      </dl>
      <div className="detail-divider"/>
      <div className="detail-section-title"><h3>Recorrido</h3><span>{run.origin || run.destination ? "SEGÚN HORARIO" : "SIN ENLACE"}</span></div>
      <dl className="detail-journey">
        <div><dt>Origen</dt><dd>{run.origin ?? "—"}</dd></div>
        <div><dt>Destino</dt><dd>{run.destination ?? "—"}</dd></div>
      </dl>
      <button type="button" className={`follow-button ${follow ? "following" : ""}`} onClick={onFollow} disabled={!run.coordinate}>
        <Focus size={14}/>{follow ? "Dejar de seguir" : "Seguir en el mapa"}
      </button>

      <div className="detail-divider"/>
      <div className="detail-section-title">
        <h3>Por dónde ha pasado</h3>
        <span>{trail ? `${trail.withCoordinate} DE ${trail.reported}` : "…"}</span>
      </div>
      {trail && trail.reported > 0 ? (
        <>
          <ol className="stop-list">
            {trail.points.slice().reverse().map((point, index) => (
              <li key={`${point.observedAt}-${point.stanox}-${index}`} className={`stop ${point.coordinate ? "" : "unmapped"}`}>
                <span className="stop-track"><i/><span/></span>
                <span className="stop-name">
                  {point.name ?? <span className="mono">{point.stanox}</span>}
                  <small>{point.eventType === "ARRIVAL" ? "llegada" : point.eventType === "DEPARTURE" ? "salida" : "paso"}{point.coordinate ? "" : " · sin coordenada"}</small>
                </span>
                <span className="mono">{hhmm.format(new Date(point.observedAt))}</span>
              </li>
            ))}
          </ol>
          <p className="map-caption-sub">
            Reconstruido desde los eventos originales. Los puntos sin coordenada no se dibujan, así que la línea del mapa salta por encima de ellos y <strong>no sigue la vía</strong>.
          </p>
        </>
      ) : (
        <p className="map-caption-sub">{trail ? "Sin reportes anteriores dentro de la ventana." : "Cargando recorrido…"}</p>
      )}
      <div className="inspector-footer"><span>POSICIÓN DE ESTACIÓN</span><span>{state === "stale" ? "DATO ENVEJECIDO" : "NO ES GPS"}</span></div>
    </>
  );
}
