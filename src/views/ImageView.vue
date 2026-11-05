<script setup lang="ts">
import {onMounted, onUnmounted, ref} from "vue";
import {IconClose, IconDelete, IconPlus, IconStop} from "@arco-design/web-vue/es/icon";

const props = defineProps<{app: any}>();

const fileInput = ref<HTMLInputElement>();
const retryStatusCodePicker = ref<HTMLElement>();
const advancedOpen = ref(false);

function closeRetryPicker(event: PointerEvent) {
  if (!retryStatusCodePicker.value?.contains(event.target as Node)) {
    props.app.retryStatusCodeMenuOpen = false;
  }
}

onMounted(() => document.addEventListener("pointerdown", closeRetryPicker));
onUnmounted(() => document.removeEventListener("pointerdown", closeRetryPicker));
</script>

<template>
  <section class="image-workspace">
    <section class="preview-panel" aria-label="预览区域">
      <div class="preview-toolbar">
        <span>{{ app.historyLoading ? "正在加载预览..." : `预览图片 ${app.results.length} 张` }}</span>
        <span v-if="app.loading" class="preview-status">{{ app.stopping ? "正在停止..." : "正在生成..." }}</span>
        <span v-if="app.previewNotice" class="preview-notice" role="status">{{ app.previewNotice }}</span>
        <a-button
            size="mini"
            class="clear-results"
            :disabled="app.historyLoading || app.results.length === 0"
            @click="app.clearResultHistory"
        ><template #icon><IconDelete/></template>清空预览</a-button>
      </div>
      <a-scrollbar outer-class="preview-scroll" class="preview-scroll-container">
        <div v-if="app.results.length" class="results">
          <div v-for="img in app.results" :key="img.id" class="result-card">
            <img
                :src="img.previewUrl"
                alt="生成结果"
                @dblclick.prevent="app.openResultLightbox(img)"
                @contextmenu.prevent="app.openResultContextMenu($event, img)"
            />
            <div class="result-actions">
              <a-button size="mini" @click="app.saveImage(img)">保存</a-button>
              <a-button size="mini" status="danger" class="delete-result" @click="app.deleteResultImage(img)">删除</a-button>
            </div>
          </div>
        </div>
        <div v-else class="placeholder preview-placeholder">
          {{ app.historyLoading ? "正在加载预览..." : app.loading ? "正在生成,请稍候..." : "生成的图片将显示在这里" }}
        </div>
      </a-scrollbar>
    </section>

    <div class="image-mobile-controls">
    <section class="image-generation-config" aria-labelledby="image-generation-config-title">
      <a-button
          id="image-generation-config-title"
          type="text"
          class="advanced-config-toggle"
          :aria-expanded="advancedOpen"
          @click="advancedOpen = !advancedOpen"
      >
        <span>高级配置</span>
        <span class="chevron" :class="{ open: advancedOpen }" aria-hidden="true"></span>
      </a-button>
      <a-scrollbar
          v-if="advancedOpen"
          outer-class="image-generation-config-scroll"
          class="image-generation-config-grid"
          :disable-horizontal="true"
      >
        <div class="field image-mobile-advanced-field">
          <span class="field-label">模型</span>
          <a-select
              v-model="app.imageModelSelection"
              :options="app.imageModelSelectOptions"
              :disabled="app.imageModelGroups.length === 0"
              class="model-provider-select"
          >
            <template #label="{data}">
              <span class="selected-model-label">{{ data.label }}</span>
              <a-tag v-if="data.providerName" size="small" class="model-provider-tag">{{ data.providerName }}</a-tag>
            </template>
          </a-select>
        </div>
        <div class="field image-mobile-advanced-field">
          <span class="field-label">尺寸</span>
          <a-select v-model="app.size">
            <a-option value="auto">自动</a-option>
            <a-option value="1024x1024">1024×1024</a-option>
            <a-option value="1536x1024">1536×1024（横）</a-option>
            <a-option value="1024x1536">1024×1536（竖）</a-option>
            <a-option value="custom">自定义</a-option>
          </a-select>
        </div>
        <div v-if="app.size === 'custom'" class="custom-size-inputs image-mobile-advanced-field" aria-label="自定义尺寸">
          <label>宽度<a-input-number v-model="app.customWidth" :min="1" :step="1"/></label>
          <span aria-hidden="true">×</span>
          <label>高度<a-input-number v-model="app.customHeight" :min="1" :step="1"/></label>
        </div>
        <label class="image-mobile-advanced-field">
          数量
          <a-input-number v-model="app.count" :min="1" :max="10" :step="1"/>
        </label>
        <div class="field">
          <span class="field-label">接口模式</span>
          <a-select v-model="app.apiMode">
            <a-option value="auto">自动（多参考图走 Chat）</a-option>
            <a-option value="images">Images 接口</a-option>
            <a-option value="chat">Chat 接口</a-option>
          </a-select>
        </div>
        <div v-if="app.imageSupportsGif" class="field">
          <span class="field-label">输出格式</span>
          <a-select v-model="app.outputFormat" aria-label="输出格式">
            <a-option value="auto">默认（静态图片）</a-option>
            <a-option value="gif">GIF 动图</a-option>
          </a-select>
        </div>
        <template v-if="app.imageSupportsGif && app.outputFormat === 'gif'">
          <label>
            GIF 帧数（2–64）
            <a-input-number v-model="app.frameCount" :min="2" :max="64" :step="1" :precision="0" aria-label="GIF 帧数"/>
          </label>
          <label>
            每帧时长（20–2000 毫秒）
            <a-input-number v-model="app.frameDurationMs" :min="20" :max="2000" :step="1" :precision="0" aria-label="GIF 每帧时长（毫秒）"/>
          </label>
        </template>
        <a-checkbox v-model="app.retryEnabled" class="checkbox-row image-retry-toggle">自动重试</a-checkbox>
        <div class="field">
          <label for="image-retry-status-code-input">重试错误码</label>
          <div ref="retryStatusCodePicker" class="combo-picker">
            <div class="combo-control combo-control-multi" :class="{ open: app.retryStatusCodeMenuOpen, disabled: !app.retryEnabled }">
              <div class="combo-values">
                <a-tag
                    v-for="code in app.retryStatusCodes"
                    :key="code"
                    :closable="app.retryEnabled"
                    class="status-code-chip"
                    @close="app.toggleRetryStatusCode(code)"
                >{{ code }}</a-tag>
                <a-input
                    id="image-retry-status-code-input"
                    v-model="app.retryStatusCodeInput"
                    :disabled="!app.retryEnabled"
                    inputmode="numeric"
                    maxlength="3"
                    autocomplete="off"
                    placeholder="输入错误码"
                    @focus="app.retryStatusCodeMenuOpen = true"
                    @input="app.retryStatusCodeMenuOpen = true"
                    @keydown.enter.prevent="app.addRetryStatusCode"
                />
              </div>
              <a-button
                  type="text"
                  size="mini"
                  class="combo-toggle"
                  aria-label="展开错误码选项"
                  :disabled="!app.retryEnabled"
                  @click="app.retryStatusCodeMenuOpen = !app.retryStatusCodeMenuOpen"
              ><span class="chevron" aria-hidden="true"></span></a-button>
            </div>
            <a-scrollbar
                v-if="app.retryStatusCodeMenuOpen && app.retryEnabled"
                outer-class="combo-menu"
                class="combo-menu-container"
                :disable-horizontal="true"
            >
              <div
                  v-for="code in app.filteredRetryStatusCodeOptions"
                  :key="code"
                  class="combo-option-row"
                  :class="{ selected: app.retryStatusCodes.includes(code) }"
              >
                <a-checkbox
                    class="combo-checkbox-option"
                    :model-value="app.retryStatusCodes.includes(code)"
                    @change="app.toggleRetryStatusCode(code)"
                >{{ code }}</a-checkbox>
                <a-button
                    v-if="!app.DEFAULT_RETRY_STATUS_CODE_OPTIONS.includes(code)"
                    type="text"
                    size="mini"
                    shape="circle"
                    class="combo-remove-option"
                    title="删除自定义选项"
                    @click="app.removeRetryStatusCodeOption(code)"
                ><IconClose/></a-button>
              </div>
              <a-button v-if="app.showRetryStatusCodeInputAction" type="text" class="combo-add" @click="app.addRetryStatusCode">
                <span aria-hidden="true">＋</span><span>添加并选择 {{ app.retryStatusCodeInputValue }}</span>
              </a-button>
              <p v-if="app.filteredRetryStatusCodeOptions.length === 0 && !app.showRetryStatusCodeInputAction" class="combo-empty">无匹配项</p>
            </a-scrollbar>
          </div>
        </div>
        <label>
          重试次数
          <a-input-number v-model="app.retryCount" :disabled="!app.retryEnabled" :min="1" :max="20"/>
        </label>
      </a-scrollbar>
    </section>

    <div class="image-generation-dock">
    <div class="ref-images">
      <div v-for="(img, index) in app.refImages" :key="img.previewUrl" class="ref-thumb">
        <img :src="img.previewUrl" :alt="img.file.name" :title="img.file.name"/>
        <a-button type="text" shape="circle" class="remove" title="移除参考图" @click="app.removeImage(index)"><IconClose/></a-button>
      </div>
      <a-button
          type="outline"
          class="add-ref"
          :class="{ 'drag-over': app.dragOver }"
          title="添加参考图（可拖拽文件或 Ctrl+V 粘贴）"
          @click="fileInput?.click()"
          @dragover.prevent="app.dragOver = true"
          @dragleave="app.dragOver = false"
          @drop.prevent="app.onDrop"
      ><IconPlus/></a-button>
      <input
          ref="fileInput"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          hidden
          @change="app.addImages"
      />
    </div>

    <div class="image-mode-hint">{{ app.hintText }}</div>

    <a-textarea
        v-model="app.prompt"
        class="image-prompt-input"
        rows="4"
        placeholder="描述你想生成的图片..."
        @keydown.ctrl.enter="app.generate"
    />

    <p v-if="app.error" class="error">{{ app.error }}</p>

    <div class="image-primary-options">
      <div class="field image-model-option">
        <span class="field-label">模型</span>
        <a-select
            v-model="app.imageModelSelection"
            :options="app.imageModelSelectOptions"
            :disabled="app.imageModelGroups.length === 0"
            class="model-provider-select"
        >
          <template #label="{data}">
            <span class="selected-model-label">{{ data.label }}</span>
            <a-tag v-if="data.providerName" size="small" class="model-provider-tag">{{ data.providerName }}</a-tag>
          </template>
        </a-select>
      </div>
      <div class="field image-size-option">
        <span class="field-label">尺寸</span>
        <a-select v-model="app.size">
          <a-option value="auto">自动</a-option>
          <a-option value="1024x1024">1024×1024</a-option>
          <a-option value="1536x1024">1536×1024（横）</a-option>
          <a-option value="1024x1536">1024×1536（竖）</a-option>
          <a-option value="custom">自定义</a-option>
        </a-select>
      </div>
      <div v-if="app.size === 'custom'" class="custom-size-inputs" aria-label="自定义尺寸">
        <label>
          宽度
          <a-input-number v-model="app.customWidth" :min="1" :step="1"/>
        </label>
        <span aria-hidden="true">×</span>
        <label>
          高度
          <a-input-number v-model="app.customHeight" :min="1" :step="1"/>
        </label>
      </div>
      <label class="image-count-option">
        数量
        <a-input-number v-model="app.count" :min="1" :max="10" :step="1"/>
      </label>
      <a-button
          v-if="app.loading"
          status="danger"
          class="stop-generation image-generate-action"
          :disabled="app.stopping"
          @click="app.stopGeneration"
      >
        <template #icon><IconStop/></template>
        {{ app.stopping ? "停止中..." : "停止" }}
      </a-button>
      <a-button v-else type="primary" class="image-generate-action" @click="app.generate">生成 (Ctrl+Enter)</a-button>
    </div>
    </div>
    </div>
  </section>
</template>
