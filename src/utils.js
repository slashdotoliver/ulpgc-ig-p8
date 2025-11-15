import * as THREE from "three";

export function loadColorTexture(path, colorSpace) {
    const loader = new THREE.TextureLoader();
    const texture = loader.load(
        path,
        () => {},
        () => {},
        () => {
            console.error(path + " texture could not be loaded");
            console.error(path);
        }
    );
    if (colorSpace !== null) {
        texture.colorSpace = colorSpace;
    }
    texture.name = path;
    return texture;
}

export function loadGrayTexture(path) {
    const loader = new THREE.TextureLoader();
    const texture = loader.load(
        path,
        () => {},
        () => {},
        () => console.error(path + " gray texture could not be loaded")
    );
    texture.colorSpace = THREE.NoColorSpace;
    texture.name = path;
    return texture;
}

export function loadCubeTexture(
    rightPath,
    leftPath,
    topPath,
    bottomPath,
    frontPath,
    backPath
) {
    const loader = new THREE.CubeTextureLoader();
    const texture = loader.load(
        [rightPath, leftPath, topPath, bottomPath, frontPath, backPath],
        () => {},
        () => {},
        () => console.error(frontPath + " cube texture could not be loaded")
    );
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.name = frontPath;
    return texture;
}

export function angularVelocityFromRadius(radius) {
    const GM = 5E9;
    return Math.sqrt(GM / Math.pow(radius, 3));
}