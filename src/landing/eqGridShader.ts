/** Shared GLSL for a logarithmic EQ-style frequency/dB grid. */
export const EQ_GRID_GLSL = `
float eqLogMin() { return log(10.0); }
float eqLogMax() { return log(40000.0); }

float eqFreqToX(float freq) {
  return (log(max(freq, 10.0)) - eqLogMin()) / (eqLogMax() - eqLogMin());
}

float eqLine(float dist, float halfWidth) {
  // Crisp core + tiny soft fringe (avoids "dotty" look at low opacity)
  float core = 1.0 - smoothstep(0.0, halfWidth * 0.55, dist);
  float fringe = 1.0 - smoothstep(halfWidth * 0.55, halfWidth * 1.35, dist);
  return max(core, fringe * 0.35);
}

float eqVertAt(float uvx, float freq, float px, float weight) {
  return eqLine(abs(uvx - eqFreqToX(freq)), px) * weight;
}

float eqFracDist(float frac, float target) {
  return min(abs(frac - target), min(abs(frac - target - 1.0), abs(frac - target + 1.0)));
}

// Returns RGB contribution for an EQ analyzer grid at uv (0..1).
// mouseNorm is cursor in UV space; pass x < 0 to disable mouse response.
vec3 eqAnalyzerGrid(vec2 uv, vec2 resolution, vec2 mouseNorm) {
  float px = 1.0 / resolution.x;
  float py = 1.0 / resolution.y;
  float aspect = resolution.x / max(resolution.y, 1.0);

  float logRange = (eqLogMax() - eqLogMin()) / log(10.0);
  float lf = mix(eqLogMin(), eqLogMax(), uv.x) / log(10.0);
  float frac = fract(lf);

  float v = 0.0;

  // Decade majors: 10 / 100 / 1k / 10k — strongest verticals
  float majorDist = abs(lf - floor(lf + 0.5)) / logRange;
  v += eqLine(majorDist, px * 1.6) * 1.0;

  // Log packing inside each decade (2..9). Weights fall off so 2/5 read stronger.
  // Positions: log10(n) for n = 2..9
  v += eqLine(eqFracDist(frac, 0.30103) / logRange, px * 1.2) * 0.55; // 2
  v += eqLine(eqFracDist(frac, 0.47712) / logRange, px * 1.05) * 0.28; // 3
  v += eqLine(eqFracDist(frac, 0.60206) / logRange, px * 1.05) * 0.22; // 4
  v += eqLine(eqFracDist(frac, 0.69897) / logRange, px * 1.2) * 0.5;  // 5
  v += eqLine(eqFracDist(frac, 0.77815) / logRange, px * 1.0) * 0.18;  // 6
  v += eqLine(eqFracDist(frac, 0.84510) / logRange, px * 1.0) * 0.16;  // 7
  v += eqLine(eqFracDist(frac, 0.90309) / logRange, px * 1.0) * 0.14;  // 8
  v += eqLine(eqFracDist(frac, 0.95424) / logRange, px * 1.0) * 0.12;  // 9

  // Classic analyzer landmarks (extra weight on 100 / 1k / 10k)
  v += eqVertAt(uv.x, 20.0, px * 1.15, 0.2);
  v += eqVertAt(uv.x, 50.0, px * 1.15, 0.2);
  v += eqVertAt(uv.x, 100.0, px * 1.35, 0.35);
  v += eqVertAt(uv.x, 200.0, px * 1.1, 0.15);
  v += eqVertAt(uv.x, 500.0, px * 1.1, 0.15);
  v += eqVertAt(uv.x, 1000.0, px * 1.4, 0.4);
  v += eqVertAt(uv.x, 2000.0, px * 1.1, 0.15);
  v += eqVertAt(uv.x, 5000.0, px * 1.1, 0.15);
  v += eqVertAt(uv.x, 10000.0, px * 1.35, 0.35);
  v += eqVertAt(uv.x, 20000.0, px * 1.15, 0.22);

  float db = (uv.y - 0.5) * 2.0;
  float h = 0.0;

  // 0 dB center — strongest horizontal
  h += eqLine(abs(uv.y - 0.5), py * 1.7) * 1.05;
  h += eqLine(abs(abs(db) - 0.25), py * 1.2) * 0.28;
  h += eqLine(abs(abs(db) - 0.5), py * 1.35) * 0.48;
  h += eqLine(abs(abs(db) - 0.75), py * 1.2) * 0.26;
  h += eqLine(abs(abs(db) - 0.125), py * 0.95) * 0.12;
  h += eqLine(abs(abs(db) - 0.375), py * 0.95) * 0.11;
  h += eqLine(abs(abs(db) - 0.625), py * 0.95) * 0.1;
  h += eqLine(abs(abs(db) - 0.875), py * 0.95) * 0.09;

  float grid = clamp(v * 0.95 + h * 0.8 + min(v, h) * 0.2, 0.0, 1.8);
  vec3 lineColor = vec3(0.52, 0.62, 0.78);

  float mouseAlive = step(0.0, mouseNorm.x);
  vec2 d = (uv - mouseNorm) * vec2(aspect, 1.0);
  float md = length(d);
  float spotlight = exp(-md * md * 9.0) * mouseAlive;
  float softHalo = exp(-md * md * 2.4) * mouseAlive;
  float ring = exp(-pow(md * 2.4 - 0.75, 2.0) * 4.0) * mouseAlive;

  // Quiet base; spotlight + soft halo reveal structure near the cursor
  float mask = 0.42 + 0.95 * spotlight + 0.28 * softHalo + 0.32 * ring;

  vec3 color = lineColor * grid * 0.24 * mask;
  color += vec3(0.65, 0.82, 1.0) * grid * spotlight * 0.28;
  color += vec3(0.28, 0.4, 0.58) * softHalo * 0.07;
  color += vec3(0.5, 0.7, 0.95) * ring * grid * 0.18;
  color += vec3(0.9, 0.95, 1.0) * spotlight * grid * 0.1;

  return color;
}
`
