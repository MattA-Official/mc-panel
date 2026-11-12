<script setup lang="ts">
/**
 * The install's own look: name, accent colour, display font, logo and favicon. Colours are
 * checked for contrast as they're picked, and the preview shows both modes.
 */
import {
  DEFAULT_ACCENT,
  DEFAULT_BRANDING,
  DEFAULT_NAME,
  FONTS,
  MAX_IMAGE_BYTES,
  MIN_CONTRAST,
  NAME_MAX,
  SHADES,
  SURFACES,
  accentProblem,
  buildScale,
  normaliseHex,
  pickShades,
  showPoweredBy,
  type BrandingSettings,
  type FontId,
  type ImageSlot,
  type PublicBranding,
} from '#shared/branding'

const toast = useToast()
const withElevation = useElevation()
const brand = useBrand()

const form = reactive({ ...DEFAULT_BRANDING })
const hexText = ref(DEFAULT_ACCENT)
/** What the form last loaded, to tell the person's edits from the saved values. */
let loaded: BrandingSettings | null = null
const sameAs = (b: BrandingSettings) =>
  form.name.trim() === b.name &&
  form.accent === b.accent &&
  form.font === b.font &&
  form.poweredBy === b.poweredBy
/**
 * Takes the saved branding into the form, unless someone is part way through editing it:
 * a change arriving from another tab (or the socket's first snapshot) mustn't wipe typing.
 */
function load(b: PublicBranding | null) {
  if (!b) return
  if (loaded && !sameAs(loaded)) return
  loaded = { name: b.name, accent: b.accent, font: b.font, poweredBy: b.poweredBy }
  Object.assign(form, loaded)
  hexText.value = b.accent
}
watch(brand, load, { immediate: true })

// The text box takes #abc, abc or #aabbcc; the picker and preview follow once it's valid.
watch(hexText, (t) => {
  const hex = normaliseHex(t)
  if (hex) form.accent = hex
})
watch(
  () => form.accent,
  (hex) => {
    if (normaliseHex(hexText.value) !== hex) hexText.value = hex
  },
)

const hexValid = computed(() => !!normaliseHex(hexText.value))
const problem = computed(() =>
  hexValid.value ? accentProblem(form.accent) : 'Use a colour like #2f6fd0.',
)
const scale = computed(() => buildScale(form.accent))
const picks = computed(() => pickShades(form.accent))

const fontItems = (Object.keys(FONTS) as FontId[]).map((id) => ({
  label: FONTS[id].label,
  value: id,
}))
const fontStyle = computed(() => {
  const f = FONTS[form.font]
  return {
    fontFamily: f.family,
    fontWeight: f.weight,
    textTransform: f.uppercase ? ('uppercase' as const) : ('none' as const),
    letterSpacing: f.tracking,
  }
})

const dirty = computed(
  () =>
    !!brand.value &&
    (form.name.trim() !== brand.value.name ||
      form.accent !== brand.value.accent ||
      form.font !== brand.value.font ||
      form.poweredBy !== brand.value.poweredBy),
)

const modes = computed(() => [
  {
    id: 'light',
    label: 'Light',
    bg: SURFACES.light[0],
    card: SURFACES.light[1],
    text: '#1b2231',
    muted: '#4c5b76',
    onPrimary: '#ffffff',
    pick: picks.value.light,
  },
  {
    id: 'dark',
    label: 'Dark',
    bg: SURFACES.dark[0],
    card: SURFACES.dark[1],
    text: '#e9edf3',
    muted: '#aeb9cb',
    onPrimary: '#1b2231',
    pick: picks.value.dark,
  },
])

const saving = ref(false)
async function save() {
  if (problem.value) return
  saving.value = true
  try {
    const b = await withElevation(() =>
      $fetch<PublicBranding>('/api/system/branding', {
        method: 'PUT',
        body: { ...form, name: form.name.trim() },
      }),
    )
    loaded = null
    setBrand(b)
    toast.add({ title: 'Branding saved', color: 'success' })
  } catch (err) {
    toast.add({
      title: "Couldn't save the branding",
      description: errorMessage(err),
      color: 'error',
    })
  } finally {
    saving.value = false
  }
}

// ------------------------------------------------------------------ images

const busy = ref<ImageSlot | 'reset' | null>(null)
const logoInput = ref<HTMLInputElement>()
const faviconInput = ref<HTMLInputElement>()

async function upload(slot: ImageSlot, e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  busy.value = slot
  try {
    const b = await withElevation(() =>
      $fetch<PublicBranding>(`/api/system/branding/${slot}`, {
        method: 'PUT',
        body: file,
        headers: { 'content-type': file.type || 'application/octet-stream' },
      }),
    )
    setBrand(b)
    toast.add({ title: slot === 'logo' ? 'Logo updated' : 'Favicon updated', color: 'success' })
  } catch (err) {
    toast.add({
      title: `Couldn't use that ${slot}`,
      description: errorMessage(err),
      color: 'error',
    })
  } finally {
    busy.value = null
  }
}

async function removeImage(slot: ImageSlot) {
  busy.value = slot
  try {
    const b = await withElevation(() =>
      $fetch<PublicBranding>(`/api/system/branding/${slot}`, { method: 'DELETE' }),
    )
    setBrand(b)
  } catch (err) {
    toast.add({
      title: `Couldn't remove the ${slot}`,
      description: errorMessage(err),
      color: 'error',
    })
  } finally {
    busy.value = null
  }
}

const confirmReset = ref(false)
async function reset() {
  busy.value = 'reset'
  try {
    const b = await withElevation(() =>
      $fetch<PublicBranding>('/api/system/branding', { method: 'DELETE' }),
    )
    loaded = null
    setBrand(b)
    confirmReset.value = false
    toast.add({ title: `Back to ${DEFAULT_NAME}'s own look`, color: 'success' })
  } catch (err) {
    toast.add({
      title: "Couldn't reset the branding",
      description: errorMessage(err),
      color: 'error',
    })
  } finally {
    busy.value = null
  }
}

const maxKb = MAX_IMAGE_BYTES / 1024
</script>

<template>
  <UCard data-doc="branding.form">
    <template #header>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 class="text-base font-semibold">Name, colour and font</h2>
          <p class="text-sm text-muted">
            Used across the panel, on the sign-in page, in Discord notifications and in in-game
            messages. You're asked for your passkey when you save.
          </p>
        </div>
      </div>
    </template>
    <form class="space-y-6" data-e2e="branding-form" @submit.prevent="save">
      <div class="grid gap-5 sm:grid-cols-2">
        <UFormField
          label="Name"
          :hint="`${form.name.length}/${NAME_MAX}`"
          required
          data-doc="branding.name"
        >
          <UInput
            v-model="form.name"
            :maxlength="NAME_MAX"
            class="w-full"
            autocomplete="off"
            data-e2e="branding-name"
          />
        </UFormField>
        <UFormField label="Display font" help="For titles and server names.">
          <USelect v-model="form.font" :items="fontItems" class="w-full" />
        </UFormField>
      </div>

      <UFormField
        label="Accent colour"
        data-doc="branding.colour"
        description="Pick your brand colour. Flytower works out lighter and darker shades and uses the ones that are easy to read."
        :error="problem ?? undefined"
      >
        <div class="flex flex-wrap items-center gap-2">
          <UPopover>
            <UButton
              color="neutral"
              variant="outline"
              aria-label="Choose a colour"
              class="size-8 p-1"
            >
              <span class="size-full rounded-sm" :style="{ background: form.accent }" />
            </UButton>
            <template #content>
              <UColorPicker v-model="form.accent" format="hex" class="p-2" />
            </template>
          </UPopover>
          <UInput
            v-model="hexText"
            class="w-32 font-mono"
            spellcheck="false"
            autocomplete="off"
            aria-label="Colour as hex"
            data-e2e="branding-accent"
          />
          <UButton
            v-if="form.accent !== DEFAULT_ACCENT"
            label="Flytower amber"
            color="neutral"
            variant="ghost"
            size="sm"
            @click="hexText = DEFAULT_ACCENT"
          />
        </div>
      </UFormField>

      <div class="space-y-2">
        <p class="text-sm font-medium">Shades</p>
        <div class="grid grid-cols-11 overflow-hidden rounded-md border border-default">
          <div
            v-for="s in SHADES"
            :key="s"
            class="flex h-12 flex-col items-center justify-end pb-1 text-[10px] tabular"
            :style="{ background: scale[s], color: s < 500 ? '#1b2231' : '#ffffff' }"
            :title="scale[s]"
          >
            <span v-if="picks.light?.shade === s" aria-label="Used in light mode">☀</span>
            <span v-if="picks.dark?.shade === s" aria-label="Used in dark mode">☾</span>
            {{ s }}
          </div>
        </div>
      </div>

      <div class="grid gap-3 sm:grid-cols-2" data-e2e="branding-preview">
        <div
          v-for="m in modes"
          :key="m.id"
          class="space-y-3 rounded-md border border-default p-4"
          :style="{ background: m.bg, color: m.text }"
        >
          <div class="flex items-center justify-between gap-2 text-xs" :style="{ color: m.muted }">
            <span>{{ m.label }} mode</span>
            <span v-if="m.pick" class="tabular">
              {{ m.pick.shade }} · {{ m.pick.ratio.toFixed(1) }}:1
              {{ m.pick.ratio >= 7 ? 'AAA' : 'AA' }}
            </span>
            <span v-else>Below {{ MIN_CONTRAST }}:1</span>
          </div>
          <div class="truncate text-2xl" :style="fontStyle">{{ form.name || DEFAULT_NAME }}</div>
          <div
            class="flex flex-wrap items-center gap-3 rounded p-3 text-sm"
            :style="{ background: m.card }"
          >
            <span
              class="rounded px-3 py-1.5 font-medium"
              :style="{ background: m.pick?.hex, color: m.onPrimary }"
              >Start server</span
            >
            <span class="underline" :style="{ color: m.pick?.hex }">See backups</span>
            <span
              class="rounded px-2 py-0.5 text-xs"
              :style="{ color: m.pick?.hex, outline: `1px solid ${m.pick?.hex}` }"
              >Update</span
            >
          </div>
        </div>
      </div>

      <USwitch
        v-model="form.poweredBy"
        label="Show “Powered by Flytower”"
        :description="
          showPoweredBy({ name: form.name, poweredBy: true })
            ? 'A small line under the menu and on the sign-in page.'
            : 'Only shown when the name isn’t Flytower.'
        "
      />

      <div class="flex flex-wrap items-center gap-2">
        <UButton
          type="submit"
          label="Save"
          :loading="saving"
          :disabled="!dirty || !!problem || !form.name.trim()"
          data-e2e="branding-save"
        />
        <span v-if="dirty" class="text-sm text-muted">Unsaved changes</span>
      </div>
    </form>
  </UCard>

  <UCard>
    <template #header>
      <h2 class="text-base font-semibold">Logo and favicon</h2>
      <p class="text-sm text-muted">
        SVG or PNG, up to {{ maxKb }} KB once cleaned. Anything that could run or load something is
        taken out of SVGs, and metadata out of PNGs. PNGs can be up to 1024 pixels a side.
      </p>
    </template>
    <div class="grid gap-6 sm:grid-cols-2">
      <div class="space-y-3">
        <p class="text-sm font-medium">Logo</p>
        <div class="flex items-center gap-4">
          <div
            class="grid h-16 w-28 shrink-0 place-items-center rounded-md border border-default bg-elevated p-2"
          >
            <img
              :src="brand?.logo ?? '/flytower-mark.svg'"
              alt="Current logo"
              class="max-h-full max-w-full object-contain"
            />
          </div>
          <div class="flex flex-wrap gap-2">
            <UButton
              label="Upload"
              icon="i-lucide-upload"
              color="neutral"
              variant="outline"
              size="sm"
              :loading="busy === 'logo'"
              @click="logoInput?.click()"
            />
            <UButton
              v-if="brand?.customLogo"
              label="Remove"
              color="neutral"
              variant="ghost"
              size="sm"
              :disabled="!!busy"
              @click="removeImage('logo')"
            />
          </div>
          <input
            ref="logoInput"
            type="file"
            accept="image/svg+xml,image/png"
            class="hidden"
            data-e2e="branding-logo-file"
            @change="upload('logo', $event)"
          />
        </div>
        <p class="text-xs text-muted">
          Shown next to the name. Square or a little wide works best. A PNG logo also becomes the
          avatar on Discord notifications.
        </p>
      </div>
      <div class="space-y-3">
        <p class="text-sm font-medium">Favicon</p>
        <div class="flex items-center gap-4">
          <div
            class="grid size-16 shrink-0 place-items-center rounded-md border border-default bg-elevated p-2"
          >
            <img
              :src="brand?.favicon ?? '/favicon.svg'"
              alt="Current favicon"
              class="size-8 object-contain"
            />
          </div>
          <div class="flex flex-wrap gap-2">
            <UButton
              label="Upload"
              icon="i-lucide-upload"
              color="neutral"
              variant="outline"
              size="sm"
              :loading="busy === 'favicon'"
              @click="faviconInput?.click()"
            />
            <UButton
              v-if="brand?.customFavicon"
              label="Remove"
              color="neutral"
              variant="ghost"
              size="sm"
              :disabled="!!busy"
              @click="removeImage('favicon')"
            />
          </div>
          <input
            ref="faviconInput"
            type="file"
            accept="image/svg+xml,image/png"
            class="hidden"
            @change="upload('favicon', $event)"
          />
        </div>
        <p class="text-xs text-muted">
          The browser tab's icon. Without one, the logo is used. Keep it simple and square.
        </p>
      </div>
    </div>
  </UCard>

  <UCard v-if="brand && !brand.isDefault">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 class="text-base font-semibold">Reset</h2>
        <p class="text-sm text-muted">
          Go back to Flytower's own name, amber, font and logo. Uploaded images are deleted.
        </p>
      </div>
      <UButton
        label="Reset to Flytower"
        color="error"
        variant="outline"
        class="self-start sm:self-center"
        @click="confirmReset = true"
      />
    </div>
    <UModal v-model:open="confirmReset" title="Reset the branding?">
      <template #body>
        <p class="text-sm">
          Everyone sees Flytower's own look straight away. You're asked for your passkey.
        </p>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton label="Keep it" color="neutral" variant="ghost" @click="confirmReset = false" />
          <UButton label="Reset" color="error" :loading="busy === 'reset'" @click="reset" />
        </div>
      </template>
    </UModal>
  </UCard>
</template>
