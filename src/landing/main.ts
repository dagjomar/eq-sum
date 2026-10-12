import { startHeroShader } from "./shader"
import "./style.css"

const canvas = document.getElementById("hero-shader")
if (canvas instanceof HTMLCanvasElement) {
  startHeroShader(canvas)
}
