import * as THREE from "three";
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {loadColorTexture, loadGrayTexture} from "./utils";

import {elements as activeSats} from "./active_small";
import {computeOrbitMarkerPosition, createOrbitLine, makeOrbitMarker, preprocessOrbits} from './orbits';

import earthColorTexturePath from "../textures/2k_earth_daymap.jpg";
import earthHeightTexturePath from "../textures/2k_earth_height_map.png";
import earthNormalTexturePath from "../textures/8k_earth_normal_map.jpg";
import earthEmissiveTexturePath from "../textures/8k_earth_nightmap_gray.png";
import earthRoughnessTexturePath from "../textures/2k_earth_specular_map.png";
import starMapTexturePath from "../textures/4k_starmap_2020.jpg";
import cloudMapTexturePath from "../textures/2k_earth_clouds.jpg";


let scene;
let camera;
let renderer;

let controls;
let earth;
let clouds;

const scale = 6371;
const millisToEarthRadians = (2 * Math.PI) / (24 * 3600 * 1000);
const timeSpeed = 1;
let lastTime = Date.now();

const timeDisplay = document.getElementById('time-display');
const constellationSelect = document.getElementById('constellation-select');

const timeFormatter = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    day: '2-digit', month: 'short', year: 'numeric'
});

let clockTimer = null;
function startClock() {
    function tick() {
        const now = new Date();
        timeDisplay.textContent = timeFormatter.format(now);
    }
    tick();
    if (clockTimer) clearInterval(clockTimer);
    clockTimer = setInterval(tick, 1000);
}
startClock();

const processedOrbits = preprocessOrbits(
    activeSats,
    {
        meanMotionIsRevsPerDay: true,
        samplesForLine: 100,
        maxElements: -1
    }
);

export function setConstellationOptions(values = [], selected = null) {
    constellationSelect.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.disabled = true;
    placeholder.selected = !selected;
    placeholder.hidden = true;
    placeholder.textContent = '— seleccionar —';
    constellationSelect.appendChild(placeholder);

    for (const v of values) {
        const opt = document.createElement('option');
        opt.value = v;
        opt.textContent = v;
        if (selected !== null && v === selected) opt.selected = true;
        constellationSelect.appendChild(opt);
    }
}

constellationSelect.addEventListener('change', (event) => {
    const name = event.target.value;
    console.log(name);

    clean();
    addConstellation(name);
});

let orbitsGroup = new THREE.Group();
let satsGroup = new THREE.Group();
let currentOrbits = [];
let sats = [];

function addEarth() {
    const colorTexture = loadColorTexture(earthColorTexturePath, THREE.SRGBColorSpace);
    const heightTexture = loadGrayTexture(earthHeightTexturePath);
    const normalTexture = loadColorTexture(earthNormalTexturePath, THREE.NoColorSpace);
    const emissiveTexture = loadGrayTexture(earthEmissiveTexturePath);
    const roughnessTexture = loadGrayTexture(earthRoughnessTexturePath);

    const geometry = new THREE.SphereGeometry(6, 100, 100);
    const placeholderMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: colorTexture,
        normalMap: normalTexture,
        normalScale: new THREE.Vector2(1, 1),
        displacementMap: heightTexture,
        displacementScale: 0.01,
        emissiveIntensity: 0.2,
        roughnessMap: roughnessTexture,
        roughness: 0.9,
        metalness: 0.2
    });

    placeholderMat.onBeforeCompile = (shader) => {
        // console.log(shader.fragmentShader);

        shader.uniforms.nightMap = { value: emissiveTexture };
        shader.uniforms.nightIntensity = { value: 0.5 };
        shader.uniforms.nightThreshold = { value: 0.01 };
        shader.uniforms.nightSmooth = { value: 0.10 };
        shader.uniforms.nightTint = { value: new THREE.Color(0xfff2a8) };

        shader.fragmentShader = `
    #define STANDARD
    #ifdef PHYSICAL
    #define IOR
    #define USE_SPECULAR
    #endif

    uniform vec3 diffuse;
    uniform vec3 emissive;
    uniform float roughness;
    uniform float metalness;
    uniform float opacity;

    // ===================================
    uniform sampler2D nightMap;
    uniform float nightIntensity;
    uniform float nightThreshold;
    uniform float nightSmooth;
    uniform vec3 nightTint;
    // ===================================

    #ifdef IOR
    uniform float ior;
    #endif
    #ifdef USE_SPECULAR
    uniform float specularIntensity;
    uniform vec3 specularColor;
    #ifdef USE_SPECULAR_COLORMAP
    uniform sampler2D specularColorMap;
    #endif
    #ifdef USE_SPECULAR_INTENSITYMAP
    uniform sampler2D specularIntensityMap;
    #endif
    #endif
    #ifdef USE_CLEARCOAT
    uniform float clearcoat;
    uniform float clearcoatRoughness;
    #endif
    #ifdef USE_IRIDESCENCE
    uniform float iridescence;
    uniform float iridescenceIOR;
    uniform float iridescenceThicknessMinimum;
    uniform float iridescenceThicknessMaximum;
    #endif
    #ifdef USE_SHEEN
    uniform vec3 sheenColor;
    uniform float sheenRoughness;
    #ifdef USE_SHEEN_COLORMAP
    uniform sampler2D sheenColorMap;
    #endif
    #ifdef USE_SHEEN_ROUGHNESSMAP
    uniform sampler2D sheenRoughnessMap;
    #endif
    #endif
    varying vec3 vViewPosition;
    #include <common>
    #include <packing>
    #include <dithering_pars_fragment>
    #include <color_pars_fragment>
    #include <uv_pars_fragment>
    #include <map_pars_fragment>
    #include <alphamap_pars_fragment>
    #include <alphatest_pars_fragment>
    #include <aomap_pars_fragment>
    #include <lightmap_pars_fragment>
    #include <emissivemap_pars_fragment>
    #include <iridescence_fragment>
    #include <cube_uv_reflection_fragment>
    #include <envmap_common_pars_fragment>
    #include <envmap_physical_pars_fragment>
    #include <fog_pars_fragment>
    #include <lights_pars_begin>
    #include <normal_pars_fragment>
    #include <lights_physical_pars_fragment>
    #include <transmission_pars_fragment>
    #include <shadowmap_pars_fragment>
    #include <bumpmap_pars_fragment>
    #include <normalmap_pars_fragment>
    #include <clearcoat_pars_fragment>
    #include <iridescence_pars_fragment>
    #include <roughnessmap_pars_fragment>
    #include <metalnessmap_pars_fragment>
    #include <logdepthbuf_pars_fragment>
    #include <clipping_planes_pars_fragment>
    void main() {
        #include <clipping_planes_fragment>
        vec4 diffuseColor = vec4( diffuse, opacity );
        ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
        vec3 totalEmissiveRadiance = emissive;
        #include <logdepthbuf_fragment>
        #include <map_fragment>
        #include <color_fragment>
        #include <alphamap_fragment>
        #include <alphatest_fragment>
        #include <roughnessmap_fragment>
        #include <metalnessmap_fragment>
        #include <normal_fragment_begin>
        #include <normal_fragment_maps>
        #include <clearcoat_normal_fragment_begin>
        #include <clearcoat_normal_fragment_maps>
        #include <emissivemap_fragment>
        
        // ===================================        
        vec3 sunDirWorld = vec3(1, 0, 0);
        vec3 sunPosView = (viewMatrix * vec4(sunDirWorld, 0.0)).xyz;
        vec3 N = normalize(normal);
        float direct = max(dot(N, sunPosView), 0.0);
        //totalEmissiveRadiance += vec3(direct);
        
        float litFactor = smoothstep(nightThreshold, nightThreshold + nightSmooth, direct);
        float nightLuma = texture2D(nightMap, vMapUv).r;
        vec3 nightColor = nightTint * nightLuma;
        float showNight = (1.0 - litFactor);
        totalEmissiveRadiance += nightColor * nightIntensity * showNight;
        
        // ===================================
        
        #include <lights_physical_fragment>
        #include <lights_fragment_begin>
        #include <lights_fragment_maps>
        #include <lights_fragment_end>
        #include <aomap_fragment>
        vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
        vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
        #include <transmission_fragment>
        vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
        #ifdef USE_SHEEN
        float sheenEnergyComp = 1.0 - 0.157 * max3( material.sheenColor );
        outgoingLight = outgoingLight * sheenEnergyComp + sheenSpecular;
        #endif
        #ifdef USE_CLEARCOAT
        float dotNVcc = saturate( dot( geometry.clearcoatNormal, geometry.viewDir ) );
        vec3 Fcc = F_Schlick( material.clearcoatF0, material.clearcoatF90, dotNVcc );
        outgoingLight = outgoingLight * ( 1.0 - material.clearcoat * Fcc ) + clearcoatSpecular * material.clearcoat;
        #endif
        #include <output_fragment>
        #include <tonemapping_fragment>
        #include <encodings_fragment>
        #include <fog_fragment>
        #include <premultiplied_alpha_fragment>
        #include <dithering_fragment>
    }
        `;
    };

    const sphere = new THREE.Mesh(geometry, placeholderMat);
    sphere.rotation.y = 50 * Math.PI / 180;
    scene.add(sphere);
    scene.add(addClouds(cloudMapTexturePath));
    scene.add(addAtmosphere());
    return sphere;
}

function addClouds(alphaPath) {
    const geometry = new THREE.SphereGeometry(6 + 100 / scale, 100, 100);

    const material = new THREE.MeshStandardMaterial({
        alphaMap: loadColorTexture(alphaPath, THREE.NoColorSpace),
        transparent: true,
        map: loadColorTexture(alphaPath, THREE.SRGBColorSpace),
        side: THREE.DoubleSide,
    });

    let mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    clouds = mesh;
    return mesh;
}

function addAtmosphere() {
    const geometry = new THREE.SphereGeometry(6 + 200 / scale, 100, 100);

    const material = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        opacity: 0.1,
        emissive: 0x50d0ff,
        transparent: true,
        side: THREE.DoubleSide,
    });

    let mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    clouds = mesh;
    return mesh;
}

function createThreeRenderer() {
    renderer = new THREE.WebGLRenderer();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.className = "renderer";
    document.body.appendChild(renderer.domElement);
    window.addEventListener('resize', onWindowResize, false);
}

function onWindowResize() {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
}

function init() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(
        75,
        window.innerWidth / window.innerHeight,
        0.1,
        3000
    );
    camera.position.set(20, 20, 20);
    createThreeRenderer();
    controls = new OrbitControls(camera, renderer.domElement);

    earth = addEarth();

    const ambientLight = new THREE.AmbientLight( 0x15232a );
    scene.add( ambientLight );

    const directionalLight = new THREE.DirectionalLight( 0xffffff, 0.5 );
    directionalLight.position.set(100, 0, 0);
    directionalLight.target = earth;
    directionalLight.castShadow = true;
    directionalLight.shadow.bias = -0.04;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    scene.add(directionalLight);

    new THREE.TextureLoader().load(starMapTexturePath, (texture) => {
        texture.mapping = THREE.EquirectangularReflectionMapping;
        texture.colorSpace = THREE.SRGBColorSpace;
        scene.background = texture;
    });

    scene.add(orbitsGroup);
    scene.add(satsGroup);
    earth.rotation.y = -2 / (2 * Math.PI);
}

function addConstellation(name) {
    for (const processedOrbit of processedOrbits) {
        if (processedOrbit.constellation !== name) continue;
        currentOrbits.push(processedOrbit);

        const line = createOrbitLine(processedOrbit.positionsLine, 0x5c0091, 0.5);
        orbitsGroup.add(line);

        const initialPos = computeOrbitMarkerPosition(processedOrbit, Date.now(), { alignWithMeanAnomaly: true });
        const sat = makeOrbitMarker(0x00ff00, 0.02);
        sat.position.set(initialPos.x, initialPos.y, initialPos.z);
        satsGroup.add(sat);
        sats.push(sat);
    }
}

function deleteObjectsOfGroup(group) {
    group.traverse(obj => {
        if (obj.isMesh || obj.isLine) {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                if (Array.isArray(obj.material)) {
                    obj.material.forEach(m => m.dispose());
                } else {
                    obj.material.dispose();
                }
            }
        }
    });
    group.clear();
}

function clean() {
    deleteObjectsOfGroup(orbitsGroup);
    deleteObjectsOfGroup(satsGroup);
    currentOrbits = [];
    sats = [];
}

function animationLoop() {
    requestAnimationFrame(animationLoop);

    const now = Date.now();
    const dt = Date.now() - lastTime;
    lastTime = now;
    const yRotationIncrement = (dt * millisToEarthRadians) * timeSpeed;
    earth.rotation.y += yRotationIncrement;
    clouds.rotation.y += 10 * yRotationIncrement;

    for (let i = 0; i < currentOrbits.length; i++) {
        const pos = computeOrbitMarkerPosition(currentOrbits[i], Date.now() * timeSpeed, { alignWithMeanAnomaly: true });
        sats[i].position.set(pos.x, pos.y, pos.z);
    }

    controls.update();
    renderer.render(scene, camera);
}

init();
animationLoop();

setConstellationOptions(
    ['IRIDIUM', 'GALILEO', 'COSMOS-GLO', 'CALSPHERE', 'GLONASS', 'STARLINK'],
    'IRIDIUM'
);
addConstellation('IRIDIUM');

