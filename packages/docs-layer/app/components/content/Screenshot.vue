<script setup lang="ts">
import { docAnchor } from '../../../anchors'
import { parseLabels, screenshotFiles, type ScreenshotData } from '../../../screens'

/**
 * `::screenshot{name="backups" anchor="world.backups" labels="a, b"}` in docs/ (#270).
 *
 * On the website: the picture `bun run docs:screens` took (light or dark to match the page),
 * numbered pins on the controls, and a numbered key under it. Pointing at a pin or a key item
 * outlines the control. In the panel there's no picture: the real thing is right there, so
 * it shows "Show me" and the same numbered controls as Show me chips.
 */
const props = withDefaults(
  defineProps<{ name: string; anchor: string; labels?: string; device?: string }>(),
  { labels: '', device: 'desktop' },
)

const showMe = inject<((anchor: string) => void) | null>('docsShowMe', null)
const main = computed(() => docAnchor(props.anchor))
const ids = computed(() => parseLabels(props.labels))

// Every screenshot's label positions, bundled at build time (a few hundred bytes each).
const all = import.meta.glob<ScreenshotData>('../../../../../docs/screens/*.json', {
  eager: true,
  import: 'default',
})
const data = computed(
  () => Object.entries(all).find(([path]) => path.endsWith(`/${props.name}.json`))?.[1] ?? null,
)
const files = computed(() => screenshotFiles(props.name))
const src = (file: string) => `/screens/${file}`

/** Labels in the order the Markdown lists them, with where they sit. */
const pins = computed(() =>
  ids.value.map((id, i) => ({
    n: i + 1,
    id,
    label: docAnchor(id)?.label ?? id,
    at: data.value?.labels.find((l) => l.anchor === id) ?? null,
  })),
)
const active = ref<number | null>(null)
const alt = computed(
  () =>
    `Screenshot of ${main.value?.label ?? 'the panel'}` +
    (pins.value.length
      ? `, numbered: ${pins.value.map((p) => `${p.n} ${p.label}`).join(', ')}`
      : ''),
)
</script>

<template>
  <div v-if="showMe" class="doc-shot-live" :data-doc-screenshot="name">
    <div class="doc-shot-live-head">
      <p class="doc-shot-live-caption"><slot mdc-unwrap="p" /></p>
      <button v-if="main" type="button" class="doc-shot-show" @click="showMe(anchor)">
        <UIcon name="i-lucide-locate-fixed" class="size-4" />
        Show me
      </button>
    </div>
    <ol v-if="pins.length" class="doc-shot-key">
      <li v-for="p in pins" :key="p.id">
        <span class="doc-shot-num" aria-hidden="true">{{ p.n }}</span>
        <Ui :anchor="p.id" />
      </li>
    </ol>
  </div>

  <figure v-else class="doc-shot" :data-doc-screenshot="name">
    <div
      v-if="data"
      class="doc-shot-frame"
      :class="{ 'doc-shot-phone': data.device === 'phone' }"
      :style="{ aspectRatio: `${data.width} / ${data.height}` }"
    >
      <img
        :src="src(files.light)"
        :alt="alt"
        :width="data.width"
        :height="data.height"
        loading="lazy"
        class="doc-shot-img dark:hidden"
      />
      <img
        :src="src(files.dark)"
        :alt="alt"
        :width="data.width"
        :height="data.height"
        loading="lazy"
        class="doc-shot-img hidden dark:block"
      />
      <template v-for="p in pins" :key="p.id">
        <template v-if="p.at">
          <span
            class="doc-shot-box"
            :class="{ 'doc-shot-box-on': active === p.n }"
            :style="{
              left: `${p.at.x}%`,
              top: `${p.at.y}%`,
              width: `${p.at.w}%`,
              height: `${p.at.h}%`,
            }"
            aria-hidden="true"
          />
          <span
            class="doc-shot-num doc-shot-pin"
            :class="{ 'doc-shot-pin-on': active === p.n }"
            :style="{ left: `${p.at.x}%`, top: `${p.at.y}%` }"
            aria-hidden="true"
            @mouseenter="active = p.n"
            @mouseleave="active = null"
            >{{ p.n }}</span
          >
        </template>
      </template>
    </div>
    <p v-else class="doc-shot-missing">
      Screenshot "{{ name }}" hasn't been taken yet: run <code>bun run docs:screens</code>.
    </p>
    <figcaption>
      <span v-if="$slots.default" class="doc-shot-caption"><slot mdc-unwrap="p" /></span>
      <ol v-if="pins.length" class="doc-shot-key">
        <li
          v-for="p in pins"
          :key="p.id"
          @mouseenter="active = p.n"
          @mouseleave="active = null"
          @focusin="active = p.n"
          @focusout="active = null"
        >
          <span class="doc-shot-num" aria-hidden="true">{{ p.n }}</span>
          <Ui :anchor="p.id" />
        </li>
      </ol>
    </figcaption>
  </figure>
</template>

<style scoped>
.doc-shot {
  margin: 1.5rem 0;
}
.doc-shot-frame {
  position: relative;
  max-width: 100%;
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: calc(var(--ui-radius) * 2);
  background: var(--ui-bg-elevated);
}
.doc-shot-phone {
  max-width: 390px;
  margin-inline: auto;
}
.doc-shot-img {
  width: 100%;
  height: 100%;
  margin: 0;
}
.doc-shot-box {
  position: absolute;
  border-radius: calc(var(--ui-radius) * 1.5);
  outline: 2px solid transparent;
  outline-offset: 3px;
  transition: outline-color 0.15s;
  pointer-events: none;
}
.doc-shot-box-on {
  outline-color: var(--ui-primary);
}
.doc-shot-num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 9999px;
  background: var(--ui-primary);
  color: var(--ui-bg);
  font-size: 0.8rem;
  font-weight: 700;
  line-height: 1;
}
.doc-shot-pin {
  position: absolute;
  transform: translate(-50%, -50%);
  box-shadow:
    0 0 0 2px var(--ui-bg),
    0 1px 4px rgb(0 0 0 / 0.35);
  cursor: default;
  transition: transform 0.15s;
}
.doc-shot-pin-on {
  transform: translate(-50%, -50%) scale(1.15);
}
@media (prefers-reduced-motion: reduce) {
  .doc-shot-pin,
  .doc-shot-box {
    transition: none;
  }
}
.doc-shot-caption {
  display: block;
  margin-top: 0.5rem;
  color: var(--ui-text-muted);
  font-size: 0.875rem;
}
.doc-shot-key {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1.25rem;
  margin: 0.75rem 0 0;
  padding: 0;
  list-style: none;
}
.doc-shot-key li {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0;
  padding: 0;
}
.doc-shot-key li::before,
.doc-shot-key li::marker {
  content: none;
}
.doc-shot-missing {
  padding: 1rem;
  border: 1px dashed var(--ui-border-accented);
  border-radius: calc(var(--ui-radius) * 2);
  color: var(--ui-text-muted);
  font-size: 0.875rem;
}
.doc-shot-live {
  margin: 1rem 0;
  padding: 0.75rem 1rem;
  border: 1px solid var(--ui-border);
  border-radius: calc(var(--ui-radius) * 2);
  background: var(--ui-bg-elevated);
}
.doc-shot-live-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}
.doc-shot-live-caption {
  margin: 0;
  color: var(--ui-text-muted);
  font-size: 0.875rem;
}
.doc-shot-show {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  flex-shrink: 0;
  padding: 0.25rem 0.6rem;
  border-radius: calc(var(--ui-radius) * 1.5);
  background: var(--ui-primary);
  color: var(--ui-bg);
  font-size: 0.875rem;
  font-weight: 600;
}
.doc-shot-show:focus-visible {
  outline: 2px solid var(--ui-primary);
  outline-offset: 2px;
}
</style>
