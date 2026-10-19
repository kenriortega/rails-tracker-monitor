import type { Station, DemoRoute, DemoTrain } from "./index";
const s = (id: string, name: string, longitude: number, latitude: number): Station => ({id, name, coordinate: [longitude, latitude]});
const euston = s("EUS", "London Euston", -0.1337, 51.5282);
const mk = s("MKC", "Milton Keynes", -0.7741, 52.0343);
const rugby = s("RUG", "Rugby", -1.2505, 52.3792);
const coventry = s("COV", "Coventry", -1.5136, 52.4008);
const birmingham = s("BHM", "Birmingham", -1.898, 52.4778);
const stafford = s("STA", "Stafford", -2.122, 52.8039);
const crewe = s("CRE", "Crewe", -2.4329, 53.0894);
const manchester = s("MAN", "Manchester", -2.2309, 53.4774);
const paddington = s("PAD", "London Paddington", -0.1774, 51.5159);
const reading = s("RDG", "Reading", -0.9717, 51.4588);
const oxford = s("OXF", "Oxford", -1.27, 51.7535);
const swindon = s("SWI", "Swindon", -1.7856, 51.5655);
const bath = s("BTH", "Bath Spa", -2.3567, 51.3777);
const bristol = s("BRI", "Bristol", -2.5804, 51.4491);
export const routes: DemoRoute[] = [
  {id: "west-coast", name: "West Coast", color: "#91edb4", stations: [euston, mk, rugby, coventry, birmingham, stafford, crewe, manchester]},
  {id: "great-western", name: "Great Western", color: "#8caef5", stations: [paddington, reading, swindon, bath, bristol]},
  {id: "cherwell", name: "Cherwell", color: "#bb9fe8", stations: [reading, oxford, coventry, birmingham]}
];
/** Synthetic services and simplified station-to-station paths. Not production train data. */
export const trains: DemoTrain[] = [
  {id:"demo-20261019-001",headcode:"1A24",operator:"Avanti West Coast",origin:"Manchester",destination:"London Euston",routeId:"west-coast",delay:4,initialProgress:0.59,durationSeconds:9500,reverse:true,stale:false,category:"passenger"},
  {id:"demo-20261019-002",headcode:"1H32",operator:"Avanti West Coast",origin:"London Euston",destination:"Manchester",routeId:"west-coast",delay:0,initialProgress:0.82,durationSeconds:12000,reverse:false,stale:false,category:"passenger"},
  {id:"demo-20261019-003",headcode:"2K18",operator:"West Midlands Railway",origin:"London Euston",destination:"Manchester",routeId:"west-coast",delay:0,initialProgress:0.08,durationSeconds:18000,reverse:false,stale:false,category:"passenger"},
  {id:"demo-20261019-004",headcode:"1B46",operator:"Great Western Railway",origin:"London Paddington",destination:"Bristol",routeId:"great-western",delay:12,initialProgress:0.65,durationSeconds:9000,reverse:false,stale:false,category:"passenger"},
  {id:"demo-20261019-005",headcode:"1L76",operator:"Great Western Railway",origin:"Bristol",destination:"London Paddington",routeId:"great-western",delay:0,initialProgress:0.67,durationSeconds:11000,reverse:true,stale:false,category:"passenger"},
  {id:"demo-20261019-006",headcode:"1M42",operator:"CrossCountry",origin:"Reading",destination:"Birmingham",routeId:"cherwell",delay:0,initialProgress:0.42,durationSeconds:10500,reverse:false,stale:false,category:"passenger"},
  {id:"demo-20261019-007",headcode:"4M88",operator:"Freightliner",origin:"Manchester",destination:"London Euston",routeId:"west-coast",delay:8,initialProgress:0.24,durationSeconds:18000,reverse:true,stale:false,category:"freight"},
  {id:"demo-20261019-008",headcode:"2O08",operator:"Great Western Railway",origin:"Reading",destination:"Birmingham",routeId:"cherwell",delay:0,initialProgress:0.79,durationSeconds:15000,reverse:false,stale:true,category:"passenger"}
];
