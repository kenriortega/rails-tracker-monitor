import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRailStations, type RailStation } from "./naptan";

const SAMPLE = `<?xml version="1.0" encoding="utf-8"?>
<NaPTAN xmlns="http://www.naptan.org.uk/">
  <StopPoints>
    <StopPoint><Descriptor><CommonName>Aberdare Rail Station</CommonName></Descriptor>
      <Place><Location><Translation><Longitude>-3.44308</Longitude><Latitude>51.71505</Latitude></Translation></Location></Place>
      <StopClassification><StopType>RLY</StopType>
        <OffStreet><Rail><AnnotatedRailRef><TiplocRef>abdare</TiplocRef><CrsRef>ABA</CrsRef></AnnotatedRailRef></Rail></OffStreet>
      </StopClassification></StopPoint>
    <StopPoint><Descriptor><CommonName>Some Bus Stop</CommonName></Descriptor>
      <Place><Location><Translation><Longitude>-2.5</Longitude><Latitude>51.4</Latitude></Translation></Location></Place>
      <StopClassification><StopType>BCT</StopType></StopClassification></StopPoint>
    <StopPoint><Descriptor><CommonName>Heritage Halt</CommonName></Descriptor>
      <Place><Location><Translation><Longitude>-1.1</Longitude><Latitude>52.2</Latitude></Translation></Location></Place>
      <StopClassification><StopType>RLY</StopType></StopClassification></StopPoint>
    <StopPoint><Descriptor><CommonName>No Geography Station</CommonName></Descriptor>
      <Place><Location><Translation></Translation></Location></Place>
      <StopClassification><StopType>RLY</StopType>
        <OffStreet><Rail><AnnotatedRailRef><TiplocRef>NOGEO</TiplocRef><CrsRef>NGO</CrsRef></AnnotatedRailRef></Rail></OffStreet>
      </StopClassification></StopPoint>
  </StopPoints>
</NaPTAN>`;

function writeSample(xml: string): string {
  const file = join(mkdtempSync(join(tmpdir(), "naptan-")), "sample.xml");
  writeFileSync(file, xml);
  return file;
}

test("only rail stops with a TIPLOC and coordinates become stations", async () => {
  const stations: RailStation[] = [];
  const totals = await parseRailStations(writeSample(SAMPLE), s => stations.push(s));
  assert.equal(totals.stopPoints, 4);
  assert.equal(totals.railStopPoints, 3);
  assert.equal(totals.withoutTiploc, 1);      // the heritage halt
  assert.equal(totals.withoutCoordinates, 1); // valid codes, null geography
  assert.equal(totals.stations, 1);
  assert.equal(stations.length, 1);
});

test("the emitted station carries an upper case TIPLOC and numeric coordinates", async () => {
  const stations: RailStation[] = [];
  await parseRailStations(writeSample(SAMPLE), s => stations.push(s));
  assert.deepEqual(stations[0], {
    tiploc: "ABDARE", crs: "ABA", name: "Aberdare Rail Station", longitude: -3.44308, latitude: 51.71505
  });
});

test("a bus stop is never emitted even though it has coordinates", async () => {
  const stations: RailStation[] = [];
  await parseRailStations(writeSample(SAMPLE), s => stations.push(s));
  assert.equal(stations.find(s => s.name === "Some Bus Stop"), undefined);
});

test("malformed XML rejects instead of returning a partial result", async () => {
  await assert.rejects(parseRailStations(writeSample("<NaPTAN><StopPoint></NaPTAN>"), () => {}));
});
