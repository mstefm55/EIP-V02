import processSurfaceAsset from "../assets/surface-process.svg";
import commerceSurfaceAsset from "../assets/surface-commerce.svg";
import eipCoreLogoLight from "../assets/branding/eip-core-logo-light.png";
import eipCoreHeroDark from "../assets/branding/eip-core-hero-dark.png";
import eipCoreIconSquare from "../assets/branding/eip-core-icon-square.png";
import eipModernFavicon from "../assets/branding/eip-modern-favicon.png";

const ASSET_LIBRARY = Object.freeze({
  "surface.process": Object.freeze({
    src: processSurfaceAsset,
    alt: "Process surface",
  }),
  "surface.ecom": Object.freeze({
    src: commerceSurfaceAsset,
    alt: "Commerce surface",
  }),
  "surface.ecom.review": Object.freeze({
    src: commerceSurfaceAsset,
    alt: "Commerce review surface",
  }),
  "brand.eip_core.logo.light": Object.freeze({
    src: eipCoreLogoLight,
    alt: "EIP CORE",
  }),
  "brand.eip_core.hero.dark": Object.freeze({
    src: eipCoreHeroDark,
    alt: "EIP CORE admin artwork",
  }),
  "brand.eip_core.icon.square": Object.freeze({
    src: eipCoreIconSquare,
    alt: "EIP CORE icon",
  }),
  "brand.eip_core.favicon.modern": Object.freeze({
    src: eipModernFavicon,
    alt: "EIP favicon",
  }),
});

function resolveAsset(assetKey) {
  if (typeof assetKey !== "string") return null;
  const normalized = assetKey.trim();
  if (!normalized) return null;
  return ASSET_LIBRARY[normalized] || null;
}

function resolveSurfaceAsset(assetKey) {
  return resolveAsset(assetKey);
}

export { resolveAsset, resolveSurfaceAsset };
