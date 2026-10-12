import { EQ_GRID_GLSL } from "./eqGridShader"

/** Fixed viewport EQ grid with mouse spotlight — sits behind page sections. */
export function startPageGrid(canvas: HTMLCanvasElement): () => void {
  function syncSize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = Math.max(1, Math.floor(window.innerWidth * dpr))
    const h = Math.max(1, Math.floor(window.innerHeight * dpr))
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
  }

  syncSize()
  const onResize = () => syncSize()
  window.addEventListener("resize", onResize)

  const raw = canvas.getContext("webgl", {
    alpha: true,
    premultipliedAlpha: false,
    antialias: false,
  })
  if (!(raw instanceof WebGLRenderingContext)) {
    return () => window.removeEventListener("resize", onResize)
  }
  const gl: WebGLRenderingContext = raw

  const vs = `attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}`

  const fs = `precision highp float;
uniform vec2 u_resolution;
uniform vec2 u_mouse;

${EQ_GRID_GLSL}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  vec2 mouseNorm = u_mouse / u_resolution;
  vec3 grid = eqAnalyzerGrid(uv, u_resolution, mouseNorm);
  // Premultiply-ish: keep lines visible through translucent sections
  float luma = max(max(grid.r, grid.g), grid.b);
  float alpha = clamp(luma * 3.8, 0.0, 0.78);
  gl_FragColor = vec4(grid * 1.5, alpha);
}`

  function compile(type: number, src: string) {
    const shader = gl.createShader(type)
    if (!shader) return null
    gl.shaderSource(shader, src)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn("[pageGrid]", gl.getShaderInfoLog(shader))
      return null
    }
    return shader
  }

  const prog = gl.createProgram()
  if (!prog) return () => window.removeEventListener("resize", onResize)

  const vertex = compile(gl.VERTEX_SHADER, vs)
  const fragment = compile(gl.FRAGMENT_SHADER, fs)
  if (!vertex || !fragment) return () => window.removeEventListener("resize", onResize)

  gl.attachShader(prog, vertex)
  gl.attachShader(prog, fragment)
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.warn("[pageGrid]", gl.getProgramInfoLog(prog))
    return () => window.removeEventListener("resize", onResize)
  }
  gl.useProgram(prog)

  const buf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  const pos = gl.getAttribLocation(prog, "a_position")
  gl.enableVertexAttribArray(pos)
  gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0)

  const uRes = gl.getUniformLocation(prog, "u_resolution")
  const uMouse = gl.getUniformLocation(prog, "u_mouse")

  gl.enable(gl.BLEND)
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

  let mouse = { x: canvas.width * 0.5, y: canvas.height * 0.5 }
  let hasMouse = false
  const onMouseMove = (event: MouseEvent) => {
    hasMouse = true
    const dpr = canvas.width / Math.max(window.innerWidth, 1)
    mouse.x = event.clientX * dpr
    mouse.y = (window.innerHeight - event.clientY) * dpr
  }
  const onMouseLeave = () => {
    hasMouse = false
  }
  window.addEventListener("mousemove", onMouseMove)
  document.addEventListener("mouseleave", onMouseLeave)

  let raf = 0
  let stopped = false
  let needsDraw = true
  const markDirty = () => {
    needsDraw = true
  }
  window.addEventListener("resize", markDirty)

  const render = () => {
    if (stopped) return
    if (needsDraw || hasMouse) {
      needsDraw = false
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      if (uRes) gl.uniform2f(uRes, canvas.width, canvas.height)
      if (uMouse) {
        if (hasMouse) gl.uniform2f(uMouse, mouse.x, mouse.y)
        else gl.uniform2f(uMouse, -1, -1)
      }
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }
    raf = requestAnimationFrame(render)
  }
  raf = requestAnimationFrame(render)

  return () => {
    stopped = true
    cancelAnimationFrame(raf)
    window.removeEventListener("resize", onResize)
    window.removeEventListener("resize", markDirty)
    window.removeEventListener("mousemove", onMouseMove)
    document.removeEventListener("mouseleave", onMouseLeave)
  }
}
