/** Animated EQ-stack WebGL background for the landing hero. */
export function startHeroShader(canvas: HTMLCanvasElement): () => void {
  function syncSize() {
    const w = canvas.clientWidth || 1280
    const h = canvas.clientHeight || 720
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
  }

  const resizeObserver =
    typeof ResizeObserver !== "undefined" ? new ResizeObserver(syncSize) : null
  resizeObserver?.observe(canvas)
  syncSize()

  const raw = canvas.getContext("webgl") || canvas.getContext("experimental-webgl")
  if (!(raw instanceof WebGLRenderingContext)) {
    return () => resizeObserver?.disconnect()
  }
  const gl: WebGLRenderingContext = raw

  const vs = `attribute vec2 a_position;
varying vec2 v_texCoord;
void main() {
  v_texCoord = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`

  const fs = `precision highp float;
uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;
varying vec2 v_texCoord;

float eqBell(float x, float centerFreq, float gain, float q) {
    float diff = (x - centerFreq) * q;
    return gain * exp(-diff * diff * 0.5);
}

float eqShelfLow(float x, float cutoff, float gain) {
    return gain / (1.0 + exp((x - cutoff) * 8.0));
}

float eqShelfHigh(float x, float cutoff, float gain) {
    return gain / (1.0 + exp((cutoff - x) * 8.0));
}

void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution.xy;
    float x = uv.x;
    float y = uv.y;
    float t = u_time * 0.35;
    vec2 mouseNorm = u_mouse / u_resolution;
    float mouseWave = (mouseNorm.x - 0.5) * 0.08;

    vec3 color = vec3(0.04, 0.045, 0.055);

    vec2 gridUv = fract(uv * vec2(60.0, 36.0 * (u_resolution.y / u_resolution.x))) - 0.5;
    float dots = smoothstep(0.08, 0.03, length(gridUv)) * 0.16;
    color += vec3(0.25, 0.35, 0.48) * dots;

    float centerLine = smoothstep(0.003, 0.0, abs(y - 0.5));
    color += vec3(0.18, 0.22, 0.28) * centerLine * 0.45;

    float c1_f1 = 0.25 + 0.08 * sin(t * 0.7);
    float c1_g1 = 0.14 * sin(t * 0.9 + 1.2);
    float c1_q1 = 5.0 + 2.5 * cos(t * 0.6);
    float c1_f2 = 0.65 + 0.06 * cos(t * 0.8 + 0.4);
    float c1_g2 = -0.12 * cos(t * 1.1 + 0.5);
    float c1_q2 = 4.0 + 1.5 * sin(t * 0.5);
    float curve1 = 0.5 + eqBell(x, c1_f1, c1_g1, c1_q1) + eqBell(x, c1_f2, c1_g2, c1_q2) + eqShelfLow(x, 0.15, 0.06 * sin(t * 0.4));
    float dist1 = abs(y - curve1);
    float glow1 = 0.015 / (dist1 * dist1 + 0.008);
    color += vec3(0.02, 0.65, 0.95) * glow1 * 0.28;

    float c2_f1 = 0.38 + 0.07 * cos(t * 0.5 + 2.0);
    float c2_g1 = -0.15 * sin(t * 0.75 + 0.8);
    float c2_q1 = 6.0 + 3.0 * sin(t * 0.85);
    float c2_f2 = 0.78 + 0.05 * sin(t * 0.95 + 3.1);
    float c2_g2 = 0.16 * cos(t * 0.65 + 1.7);
    float c2_q2 = 5.5 + 2.0 * cos(t * 0.7);
    float curve2 = 0.5 + eqBell(x, c2_f1, c2_g1, c2_q1) + eqBell(x, c2_f2, c2_g2, c2_q2);
    float dist2 = abs(y - curve2);
    float glow2 = 0.012 / (dist2 * dist2 + 0.007);
    color += vec3(0.62, 0.25, 0.98) * glow2 * 0.26;

    float c3_f1 = 0.18 + 0.05 * sin(t * 0.6 + 0.9);
    float c3_g1 = -0.18 * cos(t * 0.8 + 2.4);
    float c3_q1 = 4.5 + 2.2 * cos(t * 0.55);
    float c3_f2 = 0.50 + 0.08 * sin(t * 0.85 + 1.5);
    float c3_g2 = 0.13 * sin(t * 1.05 + 0.2);
    float c3_q2 = 7.0 + 3.0 * sin(t * 0.9);
    float curve3 = 0.5 + eqBell(x, c3_f1, c3_g1, c3_q1) + eqBell(x, c3_f2, c3_g2, c3_q2) + eqShelfHigh(x, 0.82, -0.08 * cos(t * 0.5));
    float dist3 = abs(y - curve3);
    float glow3 = 0.012 / (dist3 * dist3 + 0.006);
    color += vec3(0.96, 0.20, 0.60) * glow3 * 0.25;

    float finalSum = (curve1 - 0.5) + (curve2 - 0.5) + (curve3 - 0.5) + mouseWave;
    float sumCurve = 0.5 + finalSum * 0.85;
    float distSum = abs(y - sumCurve);
    float coreLine = smoothstep(0.0045, 0.0008, distSum);
    float sumAura = 0.008 / (distSum * distSum + 0.0018);
    vec3 colGold = vec3(1.0, 0.82, 0.12);
    vec3 colAmberCore = vec3(1.0, 0.95, 0.55);
    color += colGold * sumAura * 0.52;
    color = mix(color, colAmberCore, coreLine);

    float vignette = smoothstep(1.3, 0.35, length((uv - 0.5) * vec2(1.1, 1.4)));
    color *= vignette;

    gl_FragColor = vec4(color, 1.0);
}`

  function compileShader(type: number, src: string) {
    const shader = gl.createShader(type)
    if (!shader) return null
    gl.shaderSource(shader, src)
    gl.compileShader(shader)
    return shader
  }

  const prog = gl.createProgram()
  if (!prog) return () => resizeObserver?.disconnect()

  const vertex = compileShader(gl.VERTEX_SHADER, vs)
  const fragment = compileShader(gl.FRAGMENT_SHADER, fs)
  if (!vertex || !fragment) return () => resizeObserver?.disconnect()

  gl.attachShader(prog, vertex)
  gl.attachShader(prog, fragment)
  gl.linkProgram(prog)
  gl.useProgram(prog)

  const buf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  const pos = gl.getAttribLocation(prog, "a_position")
  gl.enableVertexAttribArray(pos)
  gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0)

  const uTime = gl.getUniformLocation(prog, "u_time")
  const uRes = gl.getUniformLocation(prog, "u_resolution")
  const uMouse = gl.getUniformLocation(prog, "u_mouse")

  let mouse = { x: canvas.width / 2, y: canvas.height / 2 }
  const onMouseMove = (event: MouseEvent) => {
    const rect = canvas.getBoundingClientRect()
    if (rect.width && rect.height) {
      const nx = (event.clientX - rect.left) / rect.width
      const ny = 1.0 - (event.clientY - rect.top) / rect.height
      mouse.x = nx * canvas.width
      mouse.y = ny * canvas.height
    }
  }
  window.addEventListener("mousemove", onMouseMove)

  let raf = 0
  let stopped = false
  const render = (t: number) => {
    if (stopped) return
    if (!resizeObserver) syncSize()
    gl.viewport(0, 0, canvas.width, canvas.height)
    if (uTime) gl.uniform1f(uTime, t * 0.001)
    if (uRes) gl.uniform2f(uRes, canvas.width, canvas.height)
    if (uMouse) gl.uniform2f(uMouse, mouse.x, mouse.y)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    raf = requestAnimationFrame(render)
  }
  raf = requestAnimationFrame(render)

  return () => {
    stopped = true
    cancelAnimationFrame(raf)
    window.removeEventListener("mousemove", onMouseMove)
    resizeObserver?.disconnect()
  }
}
