/**
 * Where clients are, for the dashboard's map: countries (capital or main city) and Sri Lankan towns,
 * and the same projections tools/console/make-map.mjs used to draw the maps (no map library).
 */
import { SRI_LANKA, WORLD } from "./map-data";

/** ISO 3166 code → [name, latitude, longitude]. */
export const COUNTRIES: Record<string, [string, number, number]> = {
  LK: ["Sri Lanka", 6.927, 79.861],
  MV: ["Maldives", 4.175, 73.509],
  IN: ["India", 28.614, 77.209],
  PK: ["Pakistan", 33.684, 73.048],
  BD: ["Bangladesh", 23.81, 90.413],
  NP: ["Nepal", 27.717, 85.324],
  BT: ["Bhutan", 27.472, 89.639],
  AE: ["United Arab Emirates", 25.205, 55.271],
  QA: ["Qatar", 25.285, 51.531],
  SA: ["Saudi Arabia", 24.713, 46.675],
  OM: ["Oman", 23.588, 58.408],
  KW: ["Kuwait", 29.376, 47.977],
  BH: ["Bahrain", 26.228, 50.586],
  SG: ["Singapore", 1.352, 103.82],
  MY: ["Malaysia", 3.139, 101.687],
  TH: ["Thailand", 13.756, 100.502],
  ID: ["Indonesia", -6.208, 106.846],
  PH: ["Philippines", 14.6, 120.984],
  VN: ["Vietnam", 21.028, 105.854],
  CN: ["China", 39.904, 116.407],
  HK: ["Hong Kong", 22.32, 114.169],
  JP: ["Japan", 35.676, 139.65],
  KR: ["South Korea", 37.567, 126.978],
  AU: ["Australia", -33.869, 151.209],
  NZ: ["New Zealand", -36.848, 174.763],
  GB: ["United Kingdom", 51.507, -0.128],
  IE: ["Ireland", 53.35, -6.26],
  FR: ["France", 48.857, 2.352],
  DE: ["Germany", 52.52, 13.405],
  IT: ["Italy", 41.903, 12.496],
  ES: ["Spain", 40.417, -3.704],
  NL: ["Netherlands", 52.368, 4.904],
  CH: ["Switzerland", 46.948, 7.447],
  SE: ["Sweden", 59.329, 18.069],
  NO: ["Norway", 59.914, 10.752],
  US: ["United States", 40.713, -74.006],
  CA: ["Canada", 43.653, -79.383],
  ZA: ["South Africa", -26.204, 28.047],
  KE: ["Kenya", -1.292, 36.822],
  SC: ["Seychelles", -4.62, 55.455],
  MU: ["Mauritius", -20.161, 57.501],
};

/** Sri Lankan towns → [latitude, longitude]. Keys are lower case. */
export const LK_TOWNS: Record<string, [number, number]> = {
  colombo: [6.927, 79.861],
  dehiwala: [6.851, 79.866],
  "mount lavinia": [6.83, 79.863],
  moratuwa: [6.773, 79.882],
  negombo: [7.208, 79.836],
  kandy: [7.291, 80.634],
  galle: [6.054, 80.221],
  matara: [5.955, 80.555],
  jaffna: [9.662, 80.026],
  trincomalee: [8.587, 81.215],
  batticaloa: [7.731, 81.675],
  anuradhapura: [8.311, 80.404],
  polonnaruwa: [7.94, 81.019],
  kurunegala: [7.486, 80.362],
  ratnapura: [6.683, 80.399],
  badulla: [6.993, 81.055],
  "nuwara eliya": [6.95, 80.789],
  ella: [6.867, 81.047],
  hambantota: [6.124, 81.119],
  kalutara: [6.585, 79.961],
  gampaha: [7.084, 80.01],
  kegalle: [7.251, 80.346],
  matale: [7.468, 80.623],
  vavuniya: [8.751, 80.497],
  mannar: [8.981, 79.904],
  ampara: [7.298, 81.682],
  puttalam: [8.036, 79.828],
  chilaw: [7.576, 79.795],
  bentota: [6.421, 79.998],
  hikkaduwa: [6.14, 80.106],
  unawatuna: [6.01, 80.249],
  mirissa: [5.948, 80.472],
  weligama: [5.975, 80.43],
  tangalle: [6.024, 80.794],
  "arugam bay": [6.84, 81.836],
  sigiriya: [7.957, 80.76],
  dambulla: [7.874, 80.651],
  kotte: [6.887, 79.919],
  "sri jayawardenepura kotte": [6.887, 79.919],
  nugegoda: [6.865, 79.9],
  maharagama: [6.848, 79.927],
  battaramulla: [6.899, 79.918],
  wattala: [6.989, 79.892],
  "ja-ela": [7.074, 79.892],
  kadawatha: [7.001, 79.953],
  panadura: [6.713, 79.903],
  horana: [6.716, 80.063],
  avissawella: [6.955, 80.21],
  kilinochchi: [9.38, 80.377],
  mullaitivu: [9.267, 80.814],
  monaragala: [6.873, 81.351],
  kalmunai: [7.417, 81.817],
  pasikudah: [7.93, 81.56],
  habarana: [8.04, 80.75],
  kitulgala: [6.989, 80.417],
  haputale: [6.768, 80.958],
  bandarawela: [6.829, 80.987],
};

export interface Place {
  country: string;
  countryName: string;
  city: string;
  lat: number;
  lng: number;
  /** True when the town is known; otherwise the dot sits on the country's main city. */
  exact: boolean;
}

export function placeOf(c: { city?: string; country?: string }): Place {
  const code = (c.country || "LK").toUpperCase();
  const [countryName, clat, clng] = COUNTRIES[code] ?? [code, NaN, NaN];
  const city = (c.city ?? "").trim();
  const town = code === "LK" ? LK_TOWNS[city.toLowerCase()] : undefined;
  if (town) return { country: code, countryName, city, lat: town[0], lng: town[1], exact: true };
  return { country: code, countryName, city, lat: clat, lng: clng, exact: false };
}

const RAD = Math.PI / 180;

/** d3-geo's Natural Earth projection with the world map's scale and position. */
export function projectWorld(lat: number, lng: number): [number, number] {
  const l = lng * RAD;
  const p = lat * RAD;
  const p2 = p * p;
  const p4 = p2 * p2;
  const x = l * (0.8707 - 0.131979 * p2 + p4 * (-0.013791 + p4 * (0.003971 * p2 - 0.001529 * p4)));
  const y = p * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4)));
  return [WORLD.translate[0] + WORLD.scale * x, WORLD.translate[1] - WORLD.scale * y];
}

/** d3-geo's Mercator projection with the Sri Lanka map's scale and position. */
export function projectSriLanka(lat: number, lng: number): [number, number] {
  const x = lng * RAD;
  const y = Math.log(Math.tan(Math.PI / 4 + (lat * RAD) / 2));
  return [SRI_LANKA.translate[0] + SRI_LANKA.scale * x, SRI_LANKA.translate[1] - SRI_LANKA.scale * y];
}
