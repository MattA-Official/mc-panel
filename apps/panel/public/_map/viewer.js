// Flytower web map viewer. Shows the tiles flytower-map drew, and where players are.
// Plain JavaScript with no libraries: tiles are images placed by position, and the page
// only ever talks to its own map folder.
'use strict'
;(() => {
  const root = document.getElementById('map')
  if (!root) return
  const title = root.dataset.title || 'Map'

  const MIN_ZOOM = -6 // 1 pixel = 64 blocks
  const MAX_ZOOM = 3 // 8 pixels per block
  const LABELS = {
    'minecraft:overworld': 'Overworld',
    'minecraft:the_nether': 'Nether',
    'minecraft:the_end': 'End',
  }

  const el = (tag, cls, text) => {
    const e = document.createElement(tag)
    if (cls) e.className = cls
    if (text != null) e.textContent = text
    return e
  }

  const tilesLayer = el('div', 'tiles')
  const markers = el('div', 'markers')
  const top = el('div', 'bar top')
  const zoomBar = el('div', 'bar zoom')
  const coords = el('div', 'bar coords')
  const people = el('div', 'bar people')
  root.append(tilesLayer, markers, top, zoomBar, coords, people)

  const heading = el('span', 'title', title)
  const picker = el('select')
  picker.setAttribute('aria-label', 'Dimension')
  top.append(heading, picker)
  const zoomIn = el('button', null, '+')
  const zoomOut = el('button', null, '−')
  zoomIn.setAttribute('aria-label', 'Zoom in')
  zoomOut.setAttribute('aria-label', 'Zoom out')
  zoomBar.append(zoomIn, zoomOut)
  coords.hidden = true

  // The view: which dimension, the block at the centre, and the zoom (a power of two).
  const view = { dim: 0, x: 0, z: 0, zoom: 0 }
  let manifest = null
  let manifestText = ''
  let rev = Date.now()
  let players = []
  const tiles = new Map()
  // How often players are asked for, and how long a marker takes to glide to its new place.
  const PLAYERS_MS = 1000
  // Further than this in one step is a teleport or portal: jump there, don't glide.
  const GLIDE_MAX = 64
  const markerEls = new Map()
  let gliding = 0

  const scale = () => 2 ** view.zoom
  const dims = () => (manifest ? manifest.dimensions : [])
  const current = () => dims()[view.dim]

  function message(text) {
    let m = root.querySelector('.message')
    if (!text) return m && m.remove()
    if (!m) root.append((m = el('div', 'message')))
    m.textContent = text
  }

  // --- Address bar: #overworld/x/z/zoom, so a view can be shared. ---

  function readHash() {
    const [dim, x, z, zoom] = decodeURIComponent(location.hash.slice(1)).split('/')
    const i = dims().findIndex((d) => d.id === dim || d.id === `minecraft:${dim}`)
    if (i >= 0) view.dim = i
    if (Number.isFinite(Number(x)) && x !== '' && x !== undefined) view.x = Number(x)
    if (Number.isFinite(Number(z)) && z !== '' && z !== undefined) view.z = Number(z)
    if (zoom !== undefined && Number.isFinite(Number(zoom))) {
      view.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(Number(zoom))))
    }
  }

  let hashTimer = 0
  function writeHash() {
    clearTimeout(hashTimer)
    hashTimer = setTimeout(() => {
      const d = current()
      if (!d) return
      const id = d.id.startsWith('minecraft:') ? d.id.slice(10) : d.id
      history.replaceState(
        null,
        '',
        `#${id}/${Math.round(view.x)}/${Math.round(view.z)}/${view.zoom}`,
      )
    }, 250)
  }

  // --- Tiles ---

  function draw() {
    const d = current()
    if (!d || !manifest) return
    const w = root.clientWidth
    const h = root.clientHeight
    const s = scale()
    const level = Math.min(manifest.levels, Math.max(0, -view.zoom))
    const blocks = manifest.tileSize * 2 ** level
    const size = blocks * s
    const [bx0, bz0, bx1, bz1] = d.bounds
    // Region bounds at this level; >> floors negatives as we need.
    const lx0 = bx0 >> level
    const lz0 = bz0 >> level
    const lx1 = bx1 >> level
    const lz1 = bz1 >> level
    const left = view.x - w / 2 / s
    const topZ = view.z - h / 2 / s
    const tx0 = Math.max(lx0, Math.floor(left / blocks))
    const tx1 = Math.min(lx1, Math.floor((left + w / s) / blocks))
    const tz0 = Math.max(lz0, Math.floor(topZ / blocks))
    const tz1 = Math.min(lz1, Math.floor((topZ + h / s) / blocks))
    const want = new Set()
    for (let tz = tz0; tz <= tz1; tz++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const key = `${d.tiles}/${level}/${tx}_${tz}`
        want.add(key)
        let img = tiles.get(key)
        if (!img) {
          img = new Image()
          img.alt = ''
          img.decoding = 'async'
          img.onerror = () => (img.style.visibility = 'hidden')
          img.src = `${d.tiles}/${level}/${tx}_${tz}.png?r=${rev}`
          tiles.set(key, img)
          tilesLayer.append(img)
        }
        img.style.left = `${Math.round((tx * blocks - left) * s)}px`
        img.style.top = `${Math.round((tz * blocks - topZ) * s)}px`
        img.style.width = img.style.height = `${Math.ceil(size)}px`
      }
    }
    for (const [key, img] of tiles) {
      if (!want.has(key)) {
        img.remove()
        tiles.delete(key)
      }
    }
    tilesLayer.classList.toggle('pixelated', s > 1)
    drawPlayers()
    writeHash()
  }

  function clearTiles() {
    for (const img of tiles.values()) img.remove()
    tiles.clear()
  }

  // --- Players ---

  // Where a player is drawn right now: part of the way from where they were to where they are.
  function at(p, now) {
    const t = Math.min(1, (now - p.since) / PLAYERS_MS)
    return { x: p.fromX + (p.x - p.fromX) * t, z: p.fromZ + (p.z - p.fromZ) * t }
  }

  function drawPlayers() {
    const d = current()
    const s = scale()
    const w = root.clientWidth
    const h = root.clientHeight
    const now = performance.now()
    const shown = new Set()
    for (const p of players) {
      if (!d || p.dimension !== d.id) continue
      shown.add(p.name)
      let m = markerEls.get(p.name)
      if (!m) {
        m = el('div', 'player')
        m.append(head(p), el('span', 'name', p.name))
        markerEls.set(p.name, m)
        markers.append(m)
      }
      const pos = at(p, now)
      m.style.left = `${(pos.x - view.x) * s + w / 2}px`
      m.style.top = `${(pos.z - view.z) * s + h / 2}px`
    }
    for (const [name, m] of markerEls) {
      if (!shown.has(name)) {
        m.remove()
        markerEls.delete(name)
      }
    }
  }

  // Redraws the markers each frame until everyone has arrived.
  function glide() {
    if (gliding) return
    const step = () => {
      drawPlayers()
      const now = performance.now()
      gliding = players.some((p) => now - p.since < PLAYERS_MS) ? requestAnimationFrame(step) : 0
    }
    gliding = requestAnimationFrame(step)
  }

  function head(p) {
    const e = el('span', 'head')
    if (p.uuid) {
      const url = `heads/${encodeURIComponent(p.uuid)}.png`
      e.style.backgroundImage = `url("${url}"), url("${url}")`
    }
    return e
  }

  function listPlayers() {
    people.replaceChildren()
    for (const p of players) {
      const b = el('button')
      b.append(head(p), el('span', null, p.name))
      b.title = `${LABELS[p.dimension] || p.dimension} ${Math.round(p.x)}, ${Math.round(p.z)}`
      b.onclick = () => {
        const i = dims().findIndex((d) => d.id === p.dimension)
        if (i >= 0 && i !== view.dim) {
          view.dim = i
          picker.value = String(i)
          clearTiles()
        }
        view.x = p.x
        view.z = p.z
        view.zoom = Math.max(view.zoom, 0)
        draw()
      }
      people.append(b)
    }
  }

  async function refreshPlayers() {
    if (document.hidden) return
    try {
      const res = await fetch('players.json', { cache: 'no-store' })
      if (!res.ok) throw new Error(String(res.status))
      const now = performance.now()
      const before = new Map(players.map((p) => [p.name, p]))
      players = ((await res.json()).players || []).map((p) => {
        const last = before.get(p.name)
        const from = last && last.dimension === p.dimension ? at(last, now) : null
        const near = from && Math.hypot(p.x - from.x, p.z - from.z) <= GLIDE_MAX
        return { ...p, fromX: near ? from.x : p.x, fromZ: near ? from.z : p.z, since: now }
      })
    } catch {
      players = []
    }
    listPlayers()
    drawPlayers()
    glide()
  }

  // --- Moving around ---

  function zoomAt(delta, px, py) {
    const before = scale()
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom + delta))
    if (next === view.zoom) return
    // Keep the block under the pointer where it is.
    const w = root.clientWidth
    const h = root.clientHeight
    const bx = view.x + (px - w / 2) / before
    const bz = view.z + (py - h / 2) / before
    view.zoom = next
    const after = scale()
    view.x = bx - (px - w / 2) / after
    view.z = bz - (py - h / 2) / after
    draw()
  }

  const pointers = new Map()
  let pinch = 0
  root.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.bar')) return
    root.setPointerCapture(e.pointerId)
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    root.classList.add('dragging')
  })
  root.addEventListener('pointermove', (e) => {
    const s = scale()
    const rect = root.getBoundingClientRect()
    const bx = view.x + (e.clientX - rect.left - root.clientWidth / 2) / s
    const bz = view.z + (e.clientY - rect.top - root.clientHeight / 2) / s
    coords.hidden = false
    coords.textContent = `x ${Math.floor(bx)}  z ${Math.floor(bz)}`
    const was = pointers.get(e.pointerId)
    if (!was) return
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()]
      const before = Math.hypot(a.x - b.x, a.y - b.y)
      was.x = e.clientX
      was.y = e.clientY
      const after = Math.hypot(a.x - b.x, a.y - b.y)
      pinch += Math.log2(after / Math.max(1, before))
      if (Math.abs(pinch) >= 1) {
        const step = Math.trunc(pinch)
        pinch -= step
        zoomAt(step, (a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top)
      }
      return
    }
    view.x -= (e.clientX - was.x) / s
    view.z -= (e.clientY - was.y) / s
    was.x = e.clientX
    was.y = e.clientY
    draw()
  })
  const release = (e) => {
    pointers.delete(e.pointerId)
    pinch = 0
    if (pointers.size === 0) root.classList.remove('dragging')
  }
  root.addEventListener('pointerup', release)
  root.addEventListener('pointercancel', release)
  root.addEventListener('pointerleave', () => (coords.hidden = true))

  let wheel = 0
  root.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault()
      wheel -= e.deltaY / (e.deltaMode === 1 ? 3 : 100)
      if (Math.abs(wheel) < 1) return
      const step = Math.trunc(wheel)
      wheel = 0
      const rect = root.getBoundingClientRect()
      zoomAt(Math.sign(step), e.clientX - rect.left, e.clientY - rect.top)
    },
    { passive: false },
  )
  root.addEventListener('dblclick', (e) => {
    if (e.target.closest('.bar')) return
    const rect = root.getBoundingClientRect()
    zoomAt(e.shiftKey ? -1 : 1, e.clientX - rect.left, e.clientY - rect.top)
  })
  zoomIn.onclick = () => zoomAt(1, root.clientWidth / 2, root.clientHeight / 2)
  zoomOut.onclick = () => zoomAt(-1, root.clientWidth / 2, root.clientHeight / 2)
  picker.onchange = () => {
    view.dim = Number(picker.value)
    clearTiles()
    draw()
  }
  window.addEventListener('resize', draw)
  window.addEventListener('hashchange', () => {
    const before = view.dim
    readHash()
    if (view.dim !== before) {
      picker.value = String(view.dim)
      clearTiles()
    }
    draw()
  })

  // --- Keeping up with the world ---

  async function loadManifest() {
    const res = await fetch('maps.json', { cache: 'no-cache' })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(String(res.status))
    return res.text()
  }

  async function refreshManifest() {
    if (document.hidden) return
    try {
      const text = await loadManifest()
      if (!text || text === manifestText) return
      manifestText = text
      manifest = JSON.parse(text)
      rev = Date.now()
      clearTiles()
      draw()
    } catch {
      // Try again next time.
    }
  }

  async function start() {
    document.title = `${title} · Map`
    let text
    try {
      text = await loadManifest()
    } catch {
      return message("The map couldn't be loaded. Try again in a moment.")
    }
    if (!text)
      return message("The map hasn't been drawn yet. Check back once the world has been explored.")
    manifestText = text
    manifest = JSON.parse(text)
    if (!dims().length)
      return message("The map hasn't been drawn yet. Check back once the world has been explored.")
    for (const [i, d] of dims().entries()) {
      const o = el('option', null, LABELS[d.id] || d.id)
      o.value = String(i)
      picker.append(o)
    }
    // Start at 0, 0 (near spawn) if it's on the map, otherwise in the middle of what is.
    const d = dims()[0]
    const size = manifest.tileSize
    const inside = d.bounds[0] <= 0 && d.bounds[2] >= 0 && d.bounds[1] <= 0 && d.bounds[3] >= 0
    if (!inside) {
      view.x = ((d.bounds[0] + d.bounds[2] + 1) / 2) * size
      view.z = ((d.bounds[1] + d.bounds[3] + 1) / 2) * size
    }
    readHash()
    picker.value = String(view.dim)
    if (dims().length < 2) picker.hidden = true
    draw()
    void refreshPlayers()
    setInterval(refreshPlayers, PLAYERS_MS)
    setInterval(refreshManifest, 60_000)
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        void refreshPlayers()
        void refreshManifest()
      }
    })
  }

  void start()
})()
