"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { Activity, ArrowRight, ArrowUpRight, Check, ChevronDown, ChevronRight, CircleHelp, Clock3, Crosshair, Database, ExternalLink, Focus, Layers3, Map, Minus, Pause, Play, Plus, Radio, RotateCcw, Route, Search, Settings2, Signal, TrainFront, WifiOff, X } from "lucide-react";
import { DEMO_DURATION, DEMO_START, delayLabel, distanceKm, routes, trainColor, trainCoordinate, trainProgress, trains, type DemoTrain } from "@rails/domain";
import { Button } from "@/components/ui/button";

const RailMap = dynamic(() => import("./rail-map"), {ssr: false, loading: () => <div className="map-loading"><Radio size={26}/><span>Preparando el mapa de operaciones…</span></div>});
const clock = (seconds: number) => new Intl.DateTimeFormat("es-ES", {timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false}).format(DEMO_START + seconds * 1000);
const shortClock = (seconds: number) => clock(seconds).slice(0, 5);
type Filter = "all" | "delayed" | "stale";
type Panel = "map" | "activity" | "sources" | "help";

export function Monitor() {
  const [seconds, setSeconds] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [operator, setOperator] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(trains[0].id);
  const [follow, setFollow] = useState(false);
  const [showStations, setShowStations] = useState(true);
  const [showLayers, setShowLayers] = useState(false);
  const [panel, setPanel] = useState<Panel>("map");
  const [mobileList, setMobileList] = useState(false);
  const [zoomAction, setZoomAction] = useState<{type: "in" | "out" | "reset"; key: number} | null>(null);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setSeconds(current => Math.min(DEMO_DURATION, current + speed)), 1000);
    return () => window.clearInterval(timer);
  }, [playing, speed]);
  useEffect(() => {if (seconds >= DEMO_DURATION) setPlaying(false);}, [seconds]);
  useEffect(() => {
    if (panel === "map") return;
    const previous = document.activeElement as HTMLElement | null;
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {setPanel("map"); return;}
      if (event.key !== "Tab") return;
      const elements = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"] button, [role="dialog"] a[href]'));
      const first = elements[0]; const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {event.preventDefault(); last?.focus();}
      else if (!event.shiftKey && document.activeElement === last) {event.preventDefault(); first?.focus();}
    };
    document.addEventListener("keydown", keydown);
    return () => {document.removeEventListener("keydown", keydown); previous?.focus();};
  }, [panel]);

  const filtered = useMemo(() => trains.filter(train => {
    const matchesQuery = `${train.headcode} ${train.operator} ${train.origin} ${train.destination}`.toLowerCase().includes(query.trim().toLowerCase());
    return matchesQuery && (operator === "all" || train.operator === operator) && (filter === "all" || (filter === "delayed" ? train.delay > 0 : train.stale));
  }), [query, filter, operator]);
  const selected = filtered.find(train => train.id === selectedId) ?? null;
  const delayed = trains.filter(train => train.delay > 0).length;
  const onTime = trains.filter(train => !train.delay && !train.stale).length;
  const selectTrain = (id: string) => {setSelectedId(id); setMobileList(false);};
  const reset = () => {setSeconds(0); setPlaying(false);};
  const zoom = (type: "in" | "out" | "reset") => {setFollow(false); setZoomAction({type, key: Date.now()});};
  const events = [
    {code: "1B46", label: "Retraso de 12 minutos", detail: "Great Western · Servicio simulado", kind: "warning", time: 0, icon: Clock3},
    {code: "2O08", label: "Posición sin actualización", detail: "Cherwell · Posición congelada", kind: "muted", time: 0, icon: WifiOff},
    {code: "1A24", label: "Avance en el corredor West Coast", detail: "Posición interpolada de demostración", kind: "success", time: 90, icon: Route},
    {code: "1M42", label: "Servicio en seguimiento", detail: "Cherwell · Dentro del horario simulado", kind: "success", time: 240, icon: Check},
    {code: "4M88", label: "Actualización de mercancías", detail: "West Coast · Servicio simulado", kind: "warning", time: 480, icon: TrainFront}
  ].filter(event => event.time <= seconds).reverse();

  return <div className="app-shell">
    <aside className="icon-rail" aria-label="Navegación principal">
      <a className="brand-symbol" href="/" aria-label="Rails inicio"><TrainFront size={25} strokeWidth={1.5}/></a>
      <div className="rail-links">
        {[{id: "map" as const, icon: Map, label: "Mapa de operaciones"}, {id: "activity" as const, icon: Activity, label: "Actividad de la demo"}, {id: "sources" as const, icon: Database, label: "Fuentes de datos"}].map(item => <Button key={item.id} variant="ghost" size="icon" aria-label={item.label} title={item.label} aria-pressed={panel === item.id} className={`rail-button ${panel === item.id ? "active" : ""}`} onClick={() => setPanel(item.id)}><item.icon size={20}/></Button>)}
      </div>
      <div className="rail-bottom"><Button variant="ghost" size="icon" aria-label="Cómo funciona la demo" title="Cómo funciona la demo" onClick={() => setPanel("help")}><CircleHelp/></Button><div className="avatar" title="Espacio de demostración">RT</div></div>
    </aside>

    <div className="workspace">
      <header className="topbar">
        <div className="wordmark">rails<span className="wordmark-dot">.</span><span className="wordmark-sub">TRACKER MONITOR</span></div>
        <div className="header-context"><span className="status-dot"/> Centro de operaciones <span className="separator">/</span> Gran Bretaña <ChevronDown size={12}/></div>
        <div className="header-right"><span className="demo-badge"><span/> DEMO INTERACTIVA</span><span className="header-date">19 OCT 2026</span><Button variant="outline" size="sm" onClick={() => setPanel("sources")}><Radio size={13}/> Datos <ArrowUpRight size={12}/></Button></div>
      </header>

      <section className="overview" aria-label="Resumen de la demostración">
        <div className="overview-heading"><span className="eyebrow">LA RED, EN PERSPECTIVA</span><h1>Cada trayecto cuenta<span>.</span></h1><p>Una mirada a lo que mueve la red.</p></div>
        <div className="metric"><span>Servicios en la demo <TrainFront/></span><div>{String(trains.length).padStart(2, "0")}<small>3 corredores</small></div><div className="metric-spark"><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/></div></div>
        <div className="metric"><span>Dentro de horario <Check/></span><div>{String(onTime).padStart(2, "0")}<small className="positive">sin retraso</small></div><div className="mini-bar"><i style={{width: `${onTime / trains.length * 100}%`}}/></div></div>
        <button className="metric metric-clickable" onClick={() => {setFilter("delayed"); setMobileList(true);}}><span>Con retraso <Clock3/></span><div className="amber">{String(delayed).padStart(2, "0")}<small>máx. +12 min</small></div><span className="metric-link">Explorar servicios <ArrowUpRight size={12}/></span></button>
        <button className="metric metric-clickable" onClick={() => {setFilter("stale"); setMobileList(true);}}><span>Sin actualización <Signal/></span><div>01<small>posición retenida</small></div><span className="metric-link">Revisar cobertura <ArrowUpRight size={12}/></span></button>
      </section>

      <div className="operations">
        <aside className={`fleet-panel ${mobileList ? "mobile-open" : ""}`} aria-label="Lista de trenes">
          <div className="panel-heading"><h2>Explorar la red</h2><span className="count-tag">{filtered.length}</span><Button className="mobile-close" variant="ghost" size="icon" aria-label="Cerrar lista" onClick={() => setMobileList(false)}><X/></Button></div>
          <label className="search-field"><Search size={15}/><input placeholder="Tren, estación u operador…" value={query} onChange={event => setQuery(event.target.value)} aria-label="Buscar tren, estación u operador"/><span>⌕</span></label>
          <div className="filter-tabs" aria-label="Filtrar servicios">{[{id: "all" as const, label: "Todos"}, {id: "delayed" as const, label: "Con retraso"}, {id: "stale" as const, label: "Sin señal"}].map(item => <button key={item.id} className={filter === item.id ? "selected" : ""} onClick={() => setFilter(item.id)} aria-pressed={filter === item.id}>{item.label}</button>)}</div>
          <label className="operator-filter"><Settings2 size={13}/><select aria-label="Filtrar por operador" value={operator} onChange={event => setOperator(event.target.value)}><option value="all">Todos los operadores</option>{Array.from(new Set(trains.map(train => train.operator))).map(name => <option key={name}>{name}</option>)}</select></label>
          <div className="fleet-list">
            {filtered.map(train => <button key={train.id} className={`train-row ${selected?.id === train.id ? "selected" : ""}`} onClick={() => selectTrain(train.id)} aria-pressed={selected?.id === train.id}>
              <div className="train-row-top"><span className="service-code"><i style={{background: trainColor(train)}}/>{train.headcode}</span><span className={`delay-tag ${train.stale ? "stale" : train.delay ? "late" : "on-time"}`}>{train.stale ? "Sin señal" : delayLabel(train.delay)}</span></div>
              <div className="train-journey"><span>{train.origin}</span><ArrowRight size={11}/><span>{train.destination}</span></div>
              <div className="train-row-bottom"><span>{train.operator}</span>{train.category === "freight" ? <span className="freight-tag">CARGA</span> : <ChevronRight size={12}/>}</div>
            </button>)}
            {!filtered.length && <div className="empty-state"><Search size={24}/><strong>Sin coincidencias</strong><span>Prueba otra estación o elimina los filtros.</span><Button variant="outline" size="sm" onClick={() => {setQuery(""); setFilter("all"); setOperator("all");}}>Restablecer filtros</Button></div>}
          </div>
          <div className="fleet-footer"><span className="status-dot"/><span>Escenario de demostración</span><span className="mono">8 / 8</span></div>
        </aside>

        <main className="map-panel" aria-label="Centro de operaciones">
          <RailMap trains={filtered} seconds={seconds} selectedId={selected?.id ?? null} onSelect={selectTrain} follow={follow} showStations={showStations} zoomAction={zoomAction}/>
          <div className="map-grid" aria-hidden="true"/>
          <div className="map-top"><div className="map-title"><span className="status-dot"/><span>VISTA DE OPERACIONES</span><span className="map-region">GB / CENTRO Y SUR</span></div><Button className="mobile-list-button" variant="outline" size="sm" onClick={() => setMobileList(true)}><TrainFront/> Trenes ({filtered.length})</Button></div>
          <div className="map-caption"><span className="eyebrow">NETWORK OVERVIEW</span><h2>Conexiones que<br/>nunca se detienen.</h2><span className="map-caption-sub">Tres corredores. Una perspectiva.</span></div>
          <div className="map-controls"><Button variant="outline" size="icon" aria-label="Acercar mapa" title="Acercar" onClick={() => zoom("in")}><Plus/></Button><Button variant="outline" size="icon" aria-label="Alejar mapa" title="Alejar" onClick={() => zoom("out")}><Minus/></Button><span/><Button variant="outline" size="icon" aria-label="Ver toda la red de demostración" title="Ver toda la red" onClick={() => zoom("reset")}><Focus/></Button><Button variant="outline" size="icon" aria-label="Opciones de capas" aria-expanded={showLayers} title="Capas" onClick={() => setShowLayers(!showLayers)}><Layers3/></Button></div>
          {showLayers && <div className="layers-popover"><strong>Capas del mapa</strong><label><input type="checkbox" checked={showStations} onChange={event => setShowStations(event.target.checked)}/> Estaciones y etiquetas</label><p>Los corredores son trazados esquemáticos de demostración.</p></div>}
          <div className="map-legend"><span><i className="legend-dot green"/> En hora</span><span><i className="legend-dot yellow"/> Retraso</span><span><i className="legend-dot gray"/> Sin señal</span></div>
          <div className="map-disclaimer"><Radio size={11}/> Posiciones simuladas · Trazados esquemáticos</div>
          <div className="north-indicator"><span>N</span><ArrowUpRight size={18}/></div>
        </main>

        <aside className="inspector" aria-label="Detalle del tren seleccionado">
          {selected ? <TrainInspector train={selected} seconds={seconds} follow={follow} onFollow={() => setFollow(!follow)} onClose={() => {setSelectedId(null); setFollow(false);}}/> : <div className="inspector-empty"><Crosshair size={30}/><h2>Un tren, su historia.</h2><p>Selecciona un servicio del mapa o la lista para explorar su recorrido.</p></div>}
        </aside>
      </div>

      <section className="timeline" aria-label="Controles de reproducción de la demostración">
        <div className="timeline-title"><span className="replay-dot"/><span>REPLAY</span><span className="timeline-date">19 OCT</span></div>
        <Button variant="ghost" size="icon" aria-label="Reiniciar reproducción" title="Reiniciar" onClick={reset}><RotateCcw size={15}/></Button>
        <Button variant="default" size="icon" className="play-button" aria-label={playing ? "Pausar reproducción" : "Reproducir demostración"} onClick={() => {if (seconds >= DEMO_DURATION) setSeconds(0); setPlaying(!playing);}}>{playing ? <Pause size={14}/> : <Play size={14}/>}</Button>
        <label className="speed-select"><select aria-label="Velocidad de reproducción" value={speed} onChange={event => setSpeed(Number(event.target.value))}><option value={1}>1×</option><option value={5}>5×</option><option value={15}>15×</option></select><ChevronDown size={10}/></label>
        <div className="scrubber"><input aria-label="Instante de la demostración en segundos" type="range" min={0} max={DEMO_DURATION} step={1} value={seconds} onChange={event => {setSeconds(Number(event.target.value)); setPlaying(false);}} style={{"--progress": `${seconds / DEMO_DURATION * 100}%`} as React.CSSProperties}/><div><span>14:42</span><span>14:52</span><span>15:02</span><span>15:12 BST</span></div></div>
        <div className="replay-clock"><strong>{clock(seconds)}</strong><span>Europe/London · BST</span></div>
      </section>

      <section className="activity-section" aria-label="Eventos de demostración">
        <div className="activity-heading"><h2><Activity size={15}/> Pulso de la red <span>{events.length} eventos</span></h2><button onClick={() => setPanel("activity")}>Ver actividad <ArrowUpRight size={13}/></button></div>
        <div className="event-cards">{events.slice(0, 3).map((event, i) => <button key={`${event.code}-${event.time}`} className="event-card" onClick={() => {setQuery(""); setFilter("all"); setOperator("all"); setSelectedId(trains.find(train => train.headcode === event.code)!.id);}}><div className={`event-icon ${event.kind}`}><event.icon size={16}/></div><div><div className="event-title"><strong>{event.code}</strong><span>{event.label}</span></div><p>{event.detail}</p></div><span className="event-time">{shortClock(event.time)}<ArrowUpRight size={12}/></span></button>)}<div className="demo-note"><div className="note-orbit"><Radio size={19}/></div><span>Explora. Pausa. Retrocede.<small>La operación, desde otra perspectiva.</small></span></div></div>
      </section>
      <footer className="statusbar"><span><span className="status-dot"/> Motor de demostración activo</span><span>Sin conexión a Network Rail <span className="statusbar-divider">|</span> WGS84 <span className="statusbar-divider">|</span> v0.1.0</span><button onClick={() => setPanel("help")}>Sobre esta experiencia <ArrowUpRight size={10}/></button></footer>
    </div>

    {panel !== "map" && <div className="dialog-backdrop" onClick={() => setPanel("map")}><section role="dialog" aria-modal="true" aria-labelledby="dialog-title" className="info-dialog" onClick={event => event.stopPropagation()} onKeyDown={event => {if (event.key === "Escape") setPanel("map");}}><Button autoFocus className="dialog-close" variant="ghost" size="icon" aria-label="Cerrar panel" onClick={() => setPanel("map")}><X/></Button>
      <span className="eyebrow">RAILS / EXPLORAR</span><h2 id="dialog-title">{panel === "sources" ? "La información detrás del mapa." : panel === "activity" ? "Pulso de la demostración." : "Una nueva perspectiva ferroviaria."}</h2>
      {panel === "sources" ? <><p>Esta entrega funciona con ocho servicios sintéticos. No hay una conexión activa con Network Rail y los recorridos entre estaciones son esquemáticos.</p><div className="source-list">{[{name:"MOVEMENT / TRUST",role:"Movimientos observados y estado del servicio"},{name:"TD + SMART",role:"Posiciones de señalización y correspondencias"},{name:"SCHEDULE + VSTP",role:"Planificación y cambios de última hora"},{name:"CORPUS + Geografía",role:"Códigos, estaciones y geometría ferroviaria"}].map(source => <div key={source.name}><Database size={16}/><div><strong>{source.name}</strong><span>{source.role}</span></div><span className="pending-tag">PENDIENTE</span></div>)}</div><a className="source-link" href="https://www.networkrail.co.uk/who-we-are/transparency-and-ethics/transparency/open-data-feeds/" target="_blank" rel="noreferrer">Consultar el catálogo de Network Rail <ExternalLink size={13}/></a></> : panel === "activity" ? <><p>Eventos narrativos del escenario simulado hasta las {clock(seconds)}. Retrocede en la línea de tiempo para ver cómo cambia esta lista.</p><div className="dialog-events">{events.map(event => <div key={event.code}><span className="mono">{shortClock(event.time)}</span><strong>{event.code}</strong><span>{event.label}</span></div>)}</div></> : <><p>Rails explora cómo visualizar una red de transporte con mapas, seguimiento y reproducción temporal. Usa la lista para elegir un tren y «Seguir tren» para acompañar su posición simulada.</p><div className="help-grid"><div><Route/><strong>Ubicación honesta</strong><span>Las posiciones son simuladas. El servicio sin señal conserva su última ubicación.</span></div><div><Clock3/><strong>El tiempo, en tus manos</strong><span>Pausa, cambia la velocidad o desplaza la línea de tiempo para explorar el escenario.</span></div></div><p className="small-note">La conexión real, la persistencia PostgreSQL y la geometría ferroviaria verificada forman parte de las siguientes entregas.</p></>}
    </section></div>}
  </div>;
}

function TrainInspector({train, seconds, follow, onFollow, onClose}: {train: DemoTrain; seconds: number; follow: boolean; onFollow: () => void; onClose: () => void}) {
  const route = routes.find(route => route.id === train.routeId)!;
  const stations = train.reverse ? [...route.stations].reverse() : route.stations;
  const distances = stations.slice(1).map((station, i) => distanceKm(stations[i].coordinate, station.coordinate));
  const total = distances.reduce((sum, value) => sum + value, 0);
  const progress = trainProgress(train, train.stale ? 0 : seconds);
  let accumulated = 0;
  const stops = stations.map((station, i) => {
    if (i) accumulated += distances[i - 1];
    const fraction = accumulated / total;
    return {...station, fraction, time: Math.round((fraction - train.initialProgress) * train.durationSeconds)};
  });
  const coordinate = trainCoordinate(train, route, seconds);
  const nextStop = stops.find(stop => stop.fraction > progress);
  return <>
    <div className="inspector-heading"><span className="eyebrow">SERVICIO SELECCIONADO</span><Button variant="ghost" size="icon" aria-label="Cerrar detalle del tren" onClick={onClose}><X size={14}/></Button></div>
    <div className="train-detail-title"><div className="detail-train-icon"><TrainFront size={23}/></div><div><h2>{train.headcode}<span>DEMO</span></h2><p>{train.operator}</p></div></div>
    <div className="detail-journey"><div><i/>{train.origin}</div><div className="journey-line"/><div><i/>{train.destination}</div></div>
    <div className="detail-status"><span className={`delay-tag ${train.stale ? "stale" : train.delay ? "late" : "on-time"}`}>{train.stale ? <WifiOff size={11}/> : train.delay ? <Clock3 size={11}/> : <Check size={11}/>} {train.stale ? "Sin actualización" : delayLabel(train.delay)}</span><span>{train.category === "freight" ? "Mercancías" : "Pasajeros"}</span></div>
    <Button className={`follow-button ${follow ? "following" : ""}`} variant={follow ? "default" : "outline"} onClick={onFollow} aria-pressed={follow}><Crosshair size={14}/>{follow ? "Siguiendo tren" : "Seguir tren"}<ArrowUpRight size={13}/></Button>
    <div className="detail-divider"/>
    <div className="detail-section-title"><h3>El recorrido</h3><span>{Math.round(progress * 100)}%</span></div>
    <div className="journey-progress"><i style={{width: `${progress * 100}%`}}/></div>
    <div className="stop-list">{stops.map((stop, i) => {
      const passed = stop.fraction <= progress;
      const next = stop.id === nextStop?.id;
      return <div className={`stop ${passed ? "passed" : ""} ${next ? "next" : ""}`} key={stop.id}><div className="stop-track"><i>{passed ? <Check size={8}/> : null}</i>{i < stops.length - 1 && <span/>}</div><div className="stop-name"><span>{stop.name}</span>{next && <small>PRÓXIMA UBICACIÓN SIMULADA</small>}</div><time>{shortClock(stop.time)}</time></div>;
    })}</div>
    <div className="position-card"><div><Signal size={13}/><strong>{train.stale ? "Posición retenida" : "Posición simulada"}</strong><span className={`status-dot ${train.stale ? "gray" : ""}`}/></div><p>{train.stale ? "Sin nuevos reportes en este escenario. El marcador permanece en su última posición." : "Interpolada sobre un trazado esquemático. No representa una medición GPS."}</p><div className="position-coords">{coordinate?.[1].toFixed(4)}° N <span>/</span> {Math.abs(coordinate?.[0] ?? 0).toFixed(4)}° W</div></div>
    <div className="inspector-footer"><span className="mono">{train.stale ? "14:42:00" : clock(seconds)} BST</span><span>ESCENARIO SINTÉTICO</span></div>
  </>;
}
