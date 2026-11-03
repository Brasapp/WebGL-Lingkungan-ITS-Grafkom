"use strict";
// =====================================================================
//  shader.js — kode GLSL (WebGL 1 / GLSL ES 1.00)
// =====================================================================
const MAX_LAMPU = 20; // jumlah maksimum point light

const SHADER = {};

// -------- Shader utama: pencahayaan Blinn-Phong + tekstur + bayangan --------
SHADER.mainVS = `
attribute vec3 aPos;
attribute vec3 aNormal;
attribute vec2 aUV;
uniform mat4 uModel, uView, uProj, uNormalMat, uLightVP;
uniform vec2 uUVScale;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec2 vUV;
varying vec4 vLightPos;
void main() {
  vec4 wp = uModel * vec4(aPos, 1.0);
  vWorldPos = wp.xyz;
  vNormal = normalize((uNormalMat * vec4(aNormal, 0.0)).xyz);
  vUV = aUV * uUVScale;
  // "normal offset": geser sedikit searah normal agar tidak muncul shadow acne
  vLightPos = uLightVP * (wp + vec4(vNormal * 0.04, 0.0));
  gl_Position = uProj * uView * wp;
}`;

SHADER.mainFS = `
precision highp float;
#define MAX_PL ${MAX_LAMPU}
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec2 vUV;
varying vec4 vLightPos;

// material
uniform vec3 uColor;
uniform sampler2D uTex;
uniform bool uUseTex;
uniform float uDetail;                    // tekstur detail (diulang lebih rapat) agar tidak buram dari dekat
uniform vec3 uTexAvg;
uniform float uShininess, uSpecular;
uniform vec3 uEmissive;
uniform float uReflect;                   // pantulan langit (lantai keramik mengkilap)
uniform vec3 uEnvTop, uEnvBottom;

// cahaya utama (matahari / bulan) + ambient hemisfer (langit & tanah)
uniform vec3 uKeyDir, uKeyColor;
uniform vec3 uSkyAmb, uGroundAmb;
uniform vec3 uCamPos;

// point light (lampu selasar & lampu taman)
uniform int uPLCount;
uniform vec3 uPLPos[MAX_PL];
uniform vec3 uPLColor[MAX_PL];

// spotlight (lampu depan motor)
uniform vec3 uSpotPos, uSpotDir, uSpotColor;
uniform float uSpotCos;

// bayangan
uniform sampler2D uShadowMap;
uniform bool uShadowOn;
uniform float uShadowTexel, uShadowBias;

uniform vec3 uFogColor;
uniform float uFogDensity;

float unpackDepth(vec4 c) {
  return dot(c, vec4(1.0, 1.0 / 255.0, 1.0 / 65025.0, 1.0 / 16581375.0));
}

// PCF 3x3: rata-rata 9 sampel agar tepi bayangan halus
float shadowFactor() {
  if (!uShadowOn) return 1.0;
  vec3 p = vLightPos.xyz / vLightPos.w * 0.5 + 0.5;
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0) return 1.0;
  float lit = 0.0;
  for (int x = -1; x <= 1; x++)
    for (int y = -1; y <= 1; y++) {
      float d = unpackDepth(texture2D(uShadowMap, p.xy + vec2(x, y) * uShadowTexel));
      lit += (p.z - uShadowBias > d) ? 0.0 : 1.0;
    }
  return lit / 9.0;
}

void main() {
  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;              // pencahayaan dua sisi
  vec3 base = uColor;
  if (uUseTex) {
    base *= texture2D(uTex, vUV).rgb;
    if (uDetail > 0.0) base *= mix(vec3(1.0), texture2D(uTex, vUV * 7.3).rgb / uTexAvg, uDetail);
  }
  vec3 V = normalize(uCamPos - vWorldPos);

  // 1) Ambient hemisfer: dari atas warna langit, dari bawah pantulan tanah
  vec3 col = base * mix(uGroundAmb, uSkyAmb, N.y * 0.5 + 0.5);

  // 2) Cahaya utama berarah (diffuse Lambert + specular Blinn-Phong) dengan bayangan
  float ndl = max(dot(N, uKeyDir), 0.0);
  if (ndl > 0.0) {
    vec3 H = normalize(uKeyDir + V);
    float spec = pow(max(dot(N, H), 0.0), uShininess) * uSpecular;
    col += (base * ndl + spec) * uKeyColor * shadowFactor();
  }

  // 3) Point light dengan atenuasi jarak
  for (int i = 0; i < MAX_PL; i++) {
    if (i >= uPLCount) break;
    vec3 L = uPLPos[i] - vWorldPos;
    float d = length(L); L /= d;
    float att = 1.0 / (1.0 + 0.2 * d + 0.12 * d * d);
    float nl = max(dot(N, L), 0.0);
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(N, H), 0.0), uShininess) * uSpecular;
    col += (base * nl + spec) * uPLColor[i] * att;
  }

  // 4) Spotlight lampu motor (kerucut cahaya dengan tepi halus)
  vec3 Ls = uSpotPos - vWorldPos;
  float ds = length(Ls); Ls /= ds;
  float cone = smoothstep(uSpotCos, uSpotCos + 0.05, dot(-Ls, uSpotDir));
  col += base * max(dot(N, Ls), 0.0) * uSpotColor * cone / (1.0 + 0.04 * ds * ds);

  // 5) Pantulan langit dengan efek Fresnel (makin miring sudut pandang, makin memantul)
  if (uReflect > 0.0) {
    vec3 R = reflect(-V, N);
    vec3 env = mix(mix(uEnvBottom, uEnvTop, clamp(R.y * 0.4, 0.0, 1.0)), vec3(0.8), 0.45);
    float fr = uReflect * (0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0));
    col = mix(col, env, fr);
  }

  col = col * 1.1 + uEmissive;
  // tone mapping filmic (ACES) — highlight tidak "pecah", bayangan tetap terbaca
  col = clamp((col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14), 0.0, 1.0);

  // kabut atmosfer (jarak jauh memudar ke warna horizon)
  float dist = length(uCamPos - vWorldPos);
  float f = 1.0 - exp(-pow(dist * uFogDensity, 2.0));
  col = mix(col, uFogColor, f);
  gl_FragColor = vec4(col, 1.0);
}`;

// -------- Shader shadow map: simpan kedalaman (dikemas ke RGBA) --------
SHADER.depthVS = `
attribute vec3 aPos;
uniform mat4 uModel, uLightVP;
void main() { gl_Position = uLightVP * uModel * vec4(aPos, 1.0); }`;

SHADER.depthFS = `
precision highp float;
vec4 packDepth(float d) {
  vec4 e = fract(vec4(1.0, 255.0, 65025.0, 16581375.0) * d);
  return e - e.yzww * vec4(1.0 / 255.0, 1.0 / 255.0, 1.0 / 255.0, 0.0);
}
void main() { gl_FragColor = packDepth(gl_FragCoord.z); }`;

// -------- Shader langit: gradien + matahari + bintang --------
SHADER.skyVS = `
attribute vec3 aPos;
uniform mat4 uViewRot, uProj;
varying vec3 vDir;
void main() {
  vDir = aPos;
  gl_Position = uProj * uViewRot * vec4(aPos * 500.0, 1.0);
}`;

SHADER.skyFS = `
precision highp float;
varying vec3 vDir;
uniform vec3 uZenith, uHorizon, uSunDir, uSunColor, uMoonDir;
uniform float uNight;
float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
void main() {
  vec3 d = normalize(vDir);
  float h = max(d.y, 0.0);
  vec3 c = mix(uHorizon, uZenith, pow(h, 0.55));
  if (d.y < 0.0) c = uHorizon * 0.85;
  float s = max(dot(d, uSunDir), 0.0);
  c += uSunColor * (pow(s, 900.0) * 6.0 + pow(s, 12.0) * 0.25);
  float m = max(dot(d, uMoonDir), 0.0);
  c += vec3(0.85, 0.88, 1.0) * smoothstep(0.9993, 0.9996, m) * uNight;
  if (d.y > 0.0) {
    float st = hash(floor(d * 260.0));
    c += vec3(step(0.9965, st) * uNight * (0.5 + 0.5 * h));
  }
  gl_FragColor = vec4(c, 1.0);
}`;

// -------- Kompilasi & link program shader --------
function compileProgram(gl, vsSrc, fsSrc) {
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + "\n" + src);
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  // simpan lokasi attribute & uniform supaya tidak dicari ulang setiap frame
  p.a = {}; p.u = {};
  const na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
  for (let i = 0; i < na; i++) { const n = gl.getActiveAttrib(p, i).name; p.a[n] = gl.getAttribLocation(p, n); }
  const nu = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < nu; i++) {
    const n = gl.getActiveUniform(p, i).name.replace(/\[0\]$/, "");
    p.u[n] = gl.getUniformLocation(p, n);
  }
  return p;
}
