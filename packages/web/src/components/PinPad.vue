<script setup vapor lang="ts">
// Full-canvas numeric keypad for the unlock PIN. The kiosk is a touchscreen
// e-paper (tap-to-complete on Vikunja is the precedent), so big solid keys
// beat a text input + a keyboard that does not exist. Digits never render —
// only dots; the pad self-clears after every submit, success or failure.

import { computed, ref } from "vue";

const emit = defineEmits<{ submit: [pin: string]; cancel: [] }>();

const PIN_MIN = 4; // the standard lease PIN; a longer one still types fine
const PIN_MAX = 8;

const digits = ref("");
const dots = computed(() => "●".repeat(digits.value.length));
const ready = computed(() => digits.value.length >= PIN_MIN);

function tap(d: string): void {
  if (digits.value.length < PIN_MAX) digits.value += d;
}

function back(): void {
  digits.value = digits.value.slice(0, -1);
}

function submit(): void {
  if (!ready.value) return; // a dead lit button is a lie — see the pager
  emit("submit", digits.value);
  digits.value = ""; // wrong-PIN feedback is App's flash; start clean
}
</script>

<template>
  <div class="pinpad">
    <div class="pinpad-card">
      <p class="pinpad-title">输入解锁 PIN</p>
      <p class="pinpad-dots">{{ dots || "…" }}</p>
      <div class="pinpad-keys">
        <button v-for="d in ['1', '2', '3', '4', '5', '6', '7', '8', '9']" :key="d" @click="tap(d)">
          {{ d }}
        </button>
        <button class="pinpad-fn" @click="back">⌫</button>
        <button @click="tap('0')">0</button>
        <!-- Pager precedent: an unusable key hides but keeps its slot —
             e-paper has no honest disabled shade, and a lit dead button is
             a lie. -->
        <button class="pinpad-fn pinpad-ok" :class="{ 'pinpad-go': ready }" @click="submit">
          解锁
        </button>
      </div>
      <button class="pinpad-cancel" @click="emit('cancel')">取消</button>
    </div>
  </div>
</template>
