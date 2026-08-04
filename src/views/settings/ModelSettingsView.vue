<script setup lang="ts">
import {ref} from "vue";
import {IconArrowLeft, IconDelete, IconPlus} from "@arco-design/web-vue/es/icon";

const props = defineProps<{ app: any }>();
const mobileProviderOpen = ref(false);

function selectProvider(id: string) {
  props.app.selectProvider(id);
  mobileProviderOpen.value = true;
}

function addProvider() {
  props.app.addProviderDraft();
  mobileProviderOpen.value = true;
}
</script>

<template>
  <div class="settings-section provider-settings-section">
    <h2>模型设置</h2>
    <div class="provider-settings-layout" :class="{'mobile-provider-open': mobileProviderOpen}">
      <aside class="provider-sidebar" aria-label="提供商列表">
        <a-scrollbar outer-class="provider-list" class="provider-list-container" :disable-horizontal="true">
          <a-button
              v-for="provider in app.providerList"
              :key="provider.id"
              type="text"
              class="provider-list-item"
              :class="{ active: app.selectedProviderId === provider.id }"
              :title="provider.name"
              @click="selectProvider(provider.id)"
          >
            <span>{{ provider.name }}</span>
            <small v-if="app.providerDraftIsNew && app.selectedProviderId === provider.id">未保存</small>
            <small v-else>{{ provider.models.length }} 个模型</small>
          </a-button>
        </a-scrollbar>
        <a-button type="outline" class="provider-add-button" @click="addProvider">
          <template #icon>
            <IconPlus/>
          </template>
          添加提供商
        </a-button>
      </aside>

      <a-scrollbar
          v-if="app.selectedProvider"
          outer-class="provider-detail"
          class="provider-detail-container"
          :disable-horizontal="true"
      >
        <form class="provider-editor" @submit.prevent="app.saveConnectionDraft">
          <a-button type="text" class="provider-mobile-back" @click="mobileProviderOpen = false">
            <template #icon><IconArrowLeft/></template>
            返回提供商列表
          </a-button>
          <div class="provider-detail-alert">
            <a-alert :show-icon="false">
              推荐使用
              <a-link href="https://api.777358.xyz/register?aff=S9FCB8HJ6EA6" target="_blank">蓝钦 AI</a-link>
              <template #action>
                <a-link href="https://api.777358.xyz/register?aff=S9FCB8HJ6EA6" target="_blank">
                  <a-button>前往注册</a-button>
                </a-link>
              </template>
            </a-alert>
          </div>

          <div class="provider-detail-header">
            <h3>{{ app.providerDraftIsNew ? '添加提供商' : '提供商信息' }}</h3>
            <a-button
                v-if="!app.providerDraftIsNew"
                status="danger"
                class="danger-action"
                :disabled="app.connectionProfiles.length <= 1 || app.hasUnsavedProviderChanges"
                @click="app.removeConnection(app.selectedProvider)"
            >
              <template #icon>
                <IconDelete/>
              </template>
              删除
            </a-button>
          </div>

          <div class="provider-editor-fields">
            <label for="provider-name-input">
              提供商名称
              <a-input
                  id="provider-name-input"
                  v-model="app.connectionDraftName"
                  autocomplete="off"
                  placeholder="例如 OpenAI"
                  @input="app.connectionDraftError = ''"
              />
            </label>
            <label for="provider-endpoint-input">
              API 地址
              <a-input
                  id="provider-endpoint-input"
                  v-model="app.connectionDraftEndpoint"
                  autocomplete="off"
                  placeholder="https://api.openai.com/v1"
                  @input="app.connectionDraftError = ''"
              />
            </label>
            <label for="provider-image-endpoint-input">
              生图端点（可选）
              <a-input
                  id="provider-image-endpoint-input"
                  v-model="app.connectionDraftImageEndpoint"
                  autocomplete="off"
                  placeholder="留空使用 API 地址"
                  @input="app.connectionDraftError = ''"
              />
              <small class="provider-field-help">仅用于生图请求和结果下载</small>
            </label>
            <label for="provider-api-key-input">
              API Key（可选）
              <a-input-password
                  id="provider-api-key-input"
                  v-model="app.connectionDraftApiKey"
                  autocomplete="new-password"
                  placeholder="sk-..."
                  @input="app.connectionDraftError = ''"
              />
            </label>
          </div>
          <p v-if="app.connectionDraftError" class="provider-editor-error">{{ app.connectionDraftError }}</p>

          <div class="provider-model-toolbar">
            <strong>模型列表</strong>
            <a-button
                class="secondary-action"
                :disabled="app.providerDraftIsNew"
                :title="app.providerDraftIsNew ? '请先保存提供商' : '添加模型'"
                @click="app.openModelModal(app.selectedProvider.id)"
            >
              <template #icon>
                <IconPlus/>
              </template>
              添加模型
            </a-button>
          </div>

          <div v-if="app.selectedProvider.models.length" class="provider-model-list">
            <article v-for="providerModel in app.selectedProvider.models" :key="providerModel.id"
                     class="provider-model-row">
              <div class="provider-model-main">
                <strong>{{ app.modelDisplayName(providerModel) }}</strong>
                <code>{{ providerModel.id }}</code>
                <p v-if="providerModel.description">{{ providerModel.description }}</p>
                <div class="provider-model-meta">
                  <span>{{ providerModel.isImage ? '生图模型' : '文字模型' }}</span>
                  <span>上下文 {{ providerModel.contextLength.toLocaleString() }}</span>
                </div>
              </div>
              <div class="provider-model-actions">
                <a-button class="secondary-action" @click="app.openModelModal(app.selectedProvider.id, providerModel)">
                  编辑
                </a-button>
                <a-button status="danger" class="danger-action"
                          @click="app.removeProviderModel(app.selectedProvider.id, providerModel.id)">删除
                </a-button>
              </div>
            </article>
          </div>
          <div v-else class="provider-model-empty">暂无模型</div>

          <div v-if="app.hasUnsavedProviderChanges" class="provider-draft-actions">
            <a-button class="modal-cancel" @click="app.cancelConnectionDraft">取消更改</a-button>
            <a-button type="primary" html-type="submit" class="modal-save">保存更改</a-button>
          </div>
        </form>
      </a-scrollbar>
    </div>
  </div>
</template>
