import * as THREE from "three";

// ---------- constantes ----------
const MU = 398600.4418; // km^3/s^2
const KM_PER_UNIT = 6371 / 6; // km por unidad de simulación
const DEG2RAD = Math.PI / 180;

// ---------- helpers ----------
function guessConstellation(name) {
    if (!name) return 'unknown';
    const s = name.toUpperCase();
    if (s.includes('STARLINK')) return 'STARLINK';
    if (s.includes('IRIDIUM')) return 'IRIDIUM';
    if (s.includes('GPS')) return 'GPS';
    if (s.includes('GALILEO')) return 'GALILEO';
    if (s.includes('GLONASS')) return 'GLONASS';
    if (s.includes('COSMOS') || s.includes('GLO')) return 'COSMOS-GLO';
    if (s.includes('CALSPHERE')) return 'CALSPHERE';
    return 'other';
}

// Construye la rotación perifocal->ECI (Rz(Omega) * Rx(inc) * Rz(omega))
function buildPerifocalToECIRotation(Omega, inc, omega) {
    const cO = Math.cos(Omega), sO = Math.sin(Omega);
    const ci = Math.cos(inc), si = Math.sin(inc);
    const cw = Math.cos(omega), sw = Math.sin(omega);

    const r11 = cO * cw - sO * ci * sw;
    const r12 = -cO * sw - sO * ci * cw;
    const r13 = sO * si;
    const r21 = sO * cw + cO * ci * sw;
    const r22 = -sO * sw + cO * ci * cw;
    const r23 = -cO * si;
    const r31 = si * sw;
    const r32 = si * cw;
    const r33 = ci;

    return [r11, r12, r13, r21, r22, r23, r31, r32, r33];
}

// normalizar [0, 2pi)
function norm2pi(x) {
    const twoPi = 2*Math.PI;
    x = x % twoPi;
    if (x < 0) x += twoPi;
    return x;
}

/**
 * elementsArray: array JSON de Celestrak-like
 * options: { meanMotionIsRevsPerDay: true, samplesForLine: 256 }
 * Returns: array processedItems
 */
export function preprocessOrbits(elementsArray, options = {}) {
    const meanMotionIsRevsPerDay = options.meanMotionIsRevsPerDay !== false;
    const samplesForLine = options.samplesForLine || 256;
    let maxElements = options.maxElements || 1_000_000;
    if (maxElements < 0) maxElements = 1_000_000;

    const processed = [];

    let counter = 0;
    for (const el of elementsArray) {
        if (counter === maxElements) break;
        counter++;
        try {
            const e = Number(el.ECCENTRICITY);
            const inc = Number(el.INCLINATION) * DEG2RAD;
            const Omega = Number(el.RA_OF_ASC_NODE) * DEG2RAD;
            const omega = Number(el.ARG_OF_PERICENTER) * DEG2RAD;
            const M0 = Number(el.MEAN_ANOMALY) * DEG2RAD;
            const meanMotion = Number(el.MEAN_MOTION);

            // mean motion to rad/s (assume rev/day by default)
            const n_rad_s = meanMotionIsRevsPerDay ? meanMotion * 2 * Math.PI / 86400.0 : meanMotion * 2 * Math.PI;

            // semi-major axis (km)
            const a_km = Math.pow(MU / (n_rad_s * n_rad_s), 1/3);

            // epoch millis
            const epochMillis = Date.parse(el.EPOCH);

            // rotation (perifocal -> ECI)
            const R_perif2eci = buildPerifocalToECIRotation(Omega, inc, omega);

            const item = {
                // identification
                name: el.OBJECT_NAME || '',
                norad: el.NORAD_CAT_ID || null,
                classification: el.CLASSIFICATION_TYPE || '',
                constellation: guessConstellation(el.OBJECT_NAME),

                // orbital constants (precomputed)
                a_km,
                e,
                inc,
                Omega,
                omega,
                n_rad_s,
                epochMillis,
                M0,

                // rotation matrix
                R_perif2eci: R_perif2eci,
            };
            const positionsLine = [];

            for (let i = 0; i < samplesForLine; i++) {
                const nu = 2 * Math.PI * (i / samplesForLine);
                const [x, y, z] = positionOnEllipseByNu(item, nu);
                positionsLine.push(new THREE.Vector3(x, y, z));
            }
            positionsLine.push(positionsLine[0]);
            item.positionsLine = positionsLine;

            processed.push(item);
        } catch (err) {
            console.warn('Error preprocesando elemento', el, err);
        }
    }

    return processed;
}

/**
 * Devuelve [x,y,z] en unidades de simulación, dado nu (rad) y el processedItem
 */
function positionOnEllipseByNu(processedItem, nu) {
    const a = processedItem.a_km;
    const e = processedItem.e;
    const R = processedItem.R_perif2eci;

    const cosNu = Math.cos(nu);
    const sinNu = Math.sin(nu);

    const r_km = a * (1 - e*e) / (1 + e * cosNu);
    const x_pf = r_km * cosNu;
    const y_pf = r_km * sinNu;

    const X = R[0]*x_pf + R[1]*y_pf;
    const Y = R[3]*x_pf + R[4]*y_pf;
    const Z = R[6]*x_pf + R[7]*y_pf;

    return [ X / KM_PER_UNIT, Y / KM_PER_UNIT, Z / KM_PER_UNIT ];
}

/**
 * processedItem must contain epochMillis and n_rad_s and optionally M0
 * options: { alignWithMeanAnomaly: boolean, speedMultiplier: number, t0Millis: overrideEpochStart }
 *
 * Returns nu (rad) computed as: f = ((t - epoch)/T) mod 1; nu = 2π f
 * If alignWithMeanAnomaly true, we shift phase by M0/(2π)
 */
function nuFromTimeSimple(processedItem, tMillis, options = {}) {
    const epochMillis = typeof options.t0Millis === 'number' ? options.t0Millis : processedItem.epochMillis;
    const n = processedItem.n_rad_s;
    const speedMultiplier = options.speedMultiplier || 1;
    const alignWithMeanAnomaly = !!options.alignWithMeanAnomaly;

    const T = 2 * Math.PI / Math.abs(n); // seconds
    const dt = (tMillis - epochMillis) / 1000.0; // seconds
    let f = (dt / T) * speedMultiplier;
    f = f - Math.floor(f); // mod 1, in [0,1)

    if (alignWithMeanAnomaly && typeof processedItem.M0 === 'number') {
        const M0_frac = norm2pi(processedItem.M0) / (2 * Math.PI);
        f = (f + M0_frac) % 1;
    }

    const nu = 2 * Math.PI * f;
    return nu;
}

/**
 * processedItem: uno de los elementos preprocesados
 * tMillis: timestamp en ms
 * opts: pasado a nuFromTimeSimple (alignWithMeanAnomaly, speedMultiplier, t0Millis)
 * Returns [x,y,z] in simulation units
 */
export function getSatellitePositionAtTimeSimple(processedItem, tMillis, opts = {}) {
    const nu = nuFromTimeSimple(processedItem, tMillis, opts);
    return positionOnEllipseByNu(processedItem, nu);
}

export function createOrbitLine(points, color, opacity) {
    const geometry = new THREE.BufferGeometry().setFromPoints(points);

    const material = new THREE.LineBasicMaterial({
        color: color,
        opacity: opacity,
        transparent: true,
    });

    const orbit = new THREE.Line(geometry, material);
    orbit.rotation.x = Math.PI / 2;
    return orbit;
}

/**
 * Calcula la posición 3D (THREE.Vector3) para un processedItem y tiempo tMillis,
 * y aplica la rotación equivalente a `orbit.rotation.x = 90deg`.
 * - opts passthrough to nuFromTimeSimple
 *
 * Devuelve THREE.Vector3 en coordenadas compatibles con la escena (lista positionsLine
 * se dibujó con orbit.rotation.x = 90°).
 */
export function computeOrbitMarkerPosition(item, tMillis, opts = {}) {
    const [x, y, z] = getSatellitePositionAtTimeSimple(item, tMillis, opts);
    const pos = new THREE.Vector3(x, y, z);

    const rot = new THREE.Euler(Math.PI / 2, 0, 0, 'XYZ');
    pos.applyEuler(rot);

    return pos;
}

export function makeOrbitMarker(color = 0xffaa00, radius = 0.02) {
    const geo = new THREE.SphereGeometry(radius, 2, 2);
    const mat = new THREE.MeshBasicMaterial({ color });
    const mesh = new THREE.Mesh(geo, mat);
    return mesh;
}