import { startPageGrid } from "./pageGrid"
import { startHeroShader } from "./shader"
import "./style.css"

const heroCanvas = document.getElementById("hero-shader")
if (heroCanvas instanceof HTMLCanvasElement) {
  startHeroShader(heroCanvas)
}

const pageGridCanvas = document.getElementById("page-eq-grid")
if (pageGridCanvas instanceof HTMLCanvasElement) {
  startPageGrid(pageGridCanvas)
}
