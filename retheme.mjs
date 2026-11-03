import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs'

// old colour -> new colour (Graphite + Slate Blue)
const colours = {
  // Dark mode
  '#111827': '#14161A', // page background
  '#0B1220': '#0E1013', // sidebar
  '#1B2636': '#1C1F25', // panels and cards
  '#253449': '#262A32', // hover
  '#354256': '#333844', // borders
  '#F1F5F9': '#F0F2F5', // text
  '#B8C4D4': '#A9B0BC', // muted text
  '#0F9D8A': '#5A7DB8', // main colour (dark)
  '#12B5A0': '#7394CC', // main colour hover (dark)
  '#193D3C': '#252E3F', // avatar background (dark)
  '#A7F3E7': '#C3D4F0', // avatar text (dark)

  // Light mode
  '#F3F6FA': '#F2F4F7', // page background
  '#14243A': '#1F2430', // sidebar
  '#EDF4F7': '#EBEEF3', // hover
  '#D9E0E8': '#D8DDE5', // borders
  '#172033': '#1B2028', // text
  '#526174': '#555F6E', // muted text
  '#087F72': '#3E5F96', // main colour (light)
  '#06665C': '#2F4B7A', // main colour hover (light)
  '#E0F3EF': '#E4EBF6', // avatar background (light)

  // Teal tints used for soft glows and highlights
  'rgba(15, 157, 138,': 'rgba(90, 125, 184,',
}

const files = ['src/index.css', 'src/App.css']

for (const file of files) {
  if (!existsSync(file)) continue

  let css = readFileSync(file, 'utf8')
  let count = 0

  for (const [from, to] of Object.entries(colours)) {
    const pattern = new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
    css = css.replace(pattern, () => {
      count++
      return to
    })
  }

  if (count > 0) {
    copyFileSync(file, file + '.bak') // backup of the original
    writeFileSync(file, css)
  }

  console.log(`${file}: ${count} colours changed`)
}