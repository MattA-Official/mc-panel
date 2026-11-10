<script setup lang="ts">
/**
 * A player's face, cut from their whole skin by CSS: the face at (8,8) with the hat layer
 * at (40,8) on top, each 8×8 on a 64-wide skin. The browser does the cropping, so the
 * server never decodes an image. Decorative: the player's name always sits beside it.
 */
const props = withDefaults(defineProps<{ uuid: string; size?: number }>(), { size: 24 })

const url = computed(() => `/api/skins/${encodeURIComponent(props.uuid)}.png`)
const hat = ref(true)

/**
 * Old 64×32 skins often filled the hat layer with solid colour, which the game ignores: if
 * no pixel of that half is see-through, it treats the whole half as empty. Do the same.
 * Newer 64×64 skins are drawn as they are.
 */
async function checkLegacyHat(src: string) {
  hat.value = true
  const img = new Image()
  img.src = src
  try {
    await img.decode()
  } catch {
    return
  }
  if (src !== url.value || img.naturalWidth !== 64 || img.naturalHeight !== 32) return
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  if (!ctx) return
  ctx.canvas.width = 32
  ctx.canvas.height = 32
  ctx.drawImage(img, 32, 0, 32, 32, 0, 0, 32, 32)
  const { data } = ctx.getImageData(0, 0, 32, 32)
  for (let i = 3; i < data.length; i += 4) if (data[i]! < 128) return
  hat.value = false
}
onMounted(() => watch(url, checkLegacyHat, { immediate: true }))

const style = computed(() => {
  const s = props.size
  const skin = `url("${url.value}")`
  // One skin pixel is s/8 screen pixels, so the 64-pixel-wide skin is s*8 wide.
  const layers = hat.value
    ? { images: [skin, skin], positions: [`${-5 * s}px ${-s}px`, `${-s}px ${-s}px`] }
    : { images: [skin], positions: [`${-s}px ${-s}px`] }
  return {
    width: `${s}px`,
    height: `${s}px`,
    backgroundImage: layers.images.join(', '),
    backgroundSize: layers.images.map(() => `${s * 8}px auto`).join(', '),
    backgroundPosition: layers.positions.join(', '),
  }
})
</script>

<template>
  <span
    aria-hidden="true"
    class="player-head inline-block shrink-0 rounded-sm bg-elevated bg-no-repeat"
    :style="style"
  />
</template>

<style scoped>
.player-head {
  image-rendering: pixelated;
}
</style>
