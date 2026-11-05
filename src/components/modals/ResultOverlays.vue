<script setup lang="ts">
import {onMounted, onUnmounted, ref} from "vue";
import {IconClose} from "@arco-design/web-vue/es/icon";

const props = defineProps<{app: any}>();
const resultContextMenu = ref<HTMLElement>();
const canvasContextMenu = ref<HTMLElement>();
const canvasDocumentContextMenu = ref<HTMLElement>();

function closeOnOutsidePointer(event: PointerEvent) {
  const target = event.target as Node;
  if (!resultContextMenu.value?.contains(target)) props.app.closeResultContextMenu();
  if (!canvasContextMenu.value?.contains(target)) props.app.closeCanvasImageContextMenu();
  if (!canvasDocumentContextMenu.value?.contains(target)) {
    props.app.closeCanvasDocumentContextMenu();
  }
}

function closeContextMenus() {
  props.app.closeResultContextMenu();
  props.app.closeCanvasImageContextMenu();
  props.app.closeCanvasDocumentContextMenu();
}

function closeOnOutsideScroll(event: Event) {
  if (event.target instanceof Element && event.target.closest(".result-context-menu")) return;
  closeContextMenus();
}

onMounted(() => {
  document.addEventListener("pointerdown", closeOnOutsidePointer);
  window.addEventListener("blur", closeContextMenus);
  window.addEventListener("resize", closeContextMenus);
  window.addEventListener("scroll", closeOnOutsideScroll, true);
});
onUnmounted(() => {
  document.removeEventListener("pointerdown", closeOnOutsidePointer);
  window.removeEventListener("blur", closeContextMenus);
  window.removeEventListener("resize", closeContextMenus);
  window.removeEventListener("scroll", closeOnOutsideScroll, true);
});
</script>

<template>
  <div
      v-if="app.resultContextMenu"
      ref="resultContextMenu"
      class="result-context-menu"
      role="menu"
      :style="{ left: `${app.resultContextMenu.x}px`, top: `${app.resultContextMenu.y}px` }"
      @pointerdown.stop
      @contextmenu.prevent
  >
    <a-button
        type="text"
        role="menuitem"
        :disabled="!app.resultContextMenu.image.prompt"
        :title="app.resultContextMenu.image.prompt ? '' : '旧版本预览未保存提示词'"
        @click="app.copyResultPrompt(app.resultContextMenu.image)"
    >复制提示词</a-button>
    <a-button type="text" role="menuitem" @click="app.copyResultImage(app.resultContextMenu.image)">{{ app.resultContextMenu.image.mime === 'image/gif' ? '复制 GIF' : '复制到剪贴板' }}</a-button>
    <a-button v-if="app.resultContextMenu.image.mime === 'image/gif'" type="text" role="menuitem" @click="app.copyResultImage(app.resultContextMenu.image, true)">复制静态帧</a-button>
    <a-button type="text" role="menuitem" @click="app.setResultAsReference(app.resultContextMenu.image)">设置为参考图</a-button>
    <a-button type="text" role="menuitem" @click="app.saveResultFromContextMenu(app.resultContextMenu.image)">保存图片</a-button>
    <a-button type="text" status="danger" class="context-delete" role="menuitem" @click="app.deleteResultFromContextMenu(app.resultContextMenu.image)">删除图片</a-button>
  </div>

  <div
      v-if="app.canvasImageContextMenu"
      ref="canvasContextMenu"
      class="result-context-menu"
      role="menu"
      :style="{ left: `${app.canvasImageContextMenu.x}px`, top: `${app.canvasImageContextMenu.y}px` }"
      @pointerdown.stop
      @contextmenu.prevent
  >
    <a-button
        type="text"
        role="menuitem"
        :disabled="!app.canvasImageContextMenu.image.prompt"
        :title="app.canvasImageContextMenu.image.prompt ? '' : '这张图片没有可复制的提示词'"
        @click="app.copyCanvasImagePrompt(app.canvasImageContextMenu.image)"
    >复制提示词</a-button>
    <a-button type="text" role="menuitem" @click="app.copyCanvasImage(app.canvasImageContextMenu.image)">{{ app.canvasImageContextMenu.image.mime === 'image/gif' ? '复制 GIF' : '复制到剪贴板' }}</a-button>
    <a-button v-if="app.canvasImageContextMenu.image.mime === 'image/gif'" type="text" role="menuitem" @click="app.copyCanvasImage(app.canvasImageContextMenu.image, true)">复制静态帧</a-button>
    <a-button type="text" role="menuitem" @click="app.saveCanvasImage(app.canvasImageContextMenu.image)">保存图片</a-button>
  </div>

  <div
      v-if="app.canvasDocumentContextMenu"
      ref="canvasDocumentContextMenu"
      class="result-context-menu canvas-document-context-menu"
      role="menu"
      :style="{ left: `${app.canvasDocumentContextMenu.x}px`, top: `${app.canvasDocumentContextMenu.y}px` }"
      @pointerdown.stop
      @contextmenu.prevent
  >
    <a-button type="text" role="menuitem" @click="app.startRenameCanvasDocument">重命名</a-button>
    <a-button type="text" status="danger" class="context-delete" role="menuitem" @click="app.requestDeleteCanvasDocument">删除画布</a-button>
  </div>

  <div
      v-if="app.enlargedResult"
      class="result-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="放大预览"
      @mousedown.self="app.closeResultLightbox"
      @wheel.stop
  >
    <a-button type="text" shape="circle" class="lightbox-close" aria-label="关闭放大预览" title="关闭" @click="app.closeResultLightbox"><IconClose/></a-button>
    <img :src="app.enlargedResult.previewUrl" alt="放大的生成结果" @contextmenu.prevent="app.openResultContextMenu($event, app.enlargedResult)" @dblclick.prevent="app.closeResultLightbox"/>
  </div>
</template>
