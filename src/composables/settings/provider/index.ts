import {computed, onMounted, onUnmounted, ref, watch, type Ref} from "vue";
import {useRouter} from "vue-router";
import type {CanvasNode, CanvasNodeData} from "../../../canvas";
import {
  DEFAULT_CONNECTION_ID,
  DEFAULT_CONNECTION_MODELS,
  DEFAULT_ENDPOINT,
  DEFAULT_MODEL_OPTIONS,
  DEFAULT_TEXT_MODEL_OPTIONS,
  createConnectionId,
  defaultProviderModels,
  modelDisplayName,
  modelSelectionKey,
  normalizeProviderModels,
  providerNameFromEndpoint,
  resolveModelSelection as resolveSelection,
  type ConnectionProfile,
  type ProviderModel,
  type ResolvedModel,
} from "../../../domain/models";

interface ProviderSettingsOptions {
  canvasNodes: Ref<CanvasNode[]>;
  updateCanvasNodeData(id: string, patch: Partial<CanvasNodeData>): void;
}

type UnsavedChangesDecision = "save" | "discard" | "cancel";

export function useProviderSettings(options: ProviderSettingsOptions) {
  const router = useRouter();
  const endpoint = ref(DEFAULT_ENDPOINT);
  const apiKey = ref("");
  const connectionProfiles = ref<ConnectionProfile[]>([{
    id: DEFAULT_CONNECTION_ID,
    name: "OpenAI",
    endpoint: DEFAULT_ENDPOINT,
    imageEndpoint: "",
    apiKey: "",
    models: defaultProviderModels(),
  }]);
  const activeConnectionId = ref(DEFAULT_CONNECTION_ID);
  const selectedProviderId = ref(DEFAULT_CONNECTION_ID);
  const connectionDraftId = ref("");
  const connectionDraftName = ref("");
  const connectionDraftEndpoint = ref("");
  const connectionDraftImageEndpoint = ref("");
  const connectionDraftApiKey = ref("");
  const connectionDraftError = ref("");
  const providerDraftIsNew = ref(false);
  const providerDraftPreviousId = ref(DEFAULT_CONNECTION_ID);
  const unsavedChangesModalOpen = ref(false);
  const modelModalOpen = ref(false);
  const modelDraftProviderId = ref("");
  const modelDraftOriginalId = ref("");
  const modelDraftId = ref("");
  const modelDraftDisplayName = ref("");
  const modelDraftDescription = ref("");
  const modelDraftIsImage = ref(false);
  const modelDraftContextLength = ref(256000);
  const modelDraftError = ref("");
  const model = ref("gpt-image-2");
  const modelOptions = ref([...DEFAULT_MODEL_OPTIONS]);
  const textModel = ref("gpt-4o-mini");
  const textModelOptions = ref([...DEFAULT_TEXT_MODEL_OPTIONS]);
  const imageModelSelection = ref("");
  const chatModelSelection = ref("");
  const titleModelSelection = ref("current");

  const imageModelGroups = computed(() => connectionProfiles.value
      .map((provider) => ({provider, models: provider.models.filter((item) => item.isImage)}))
      .filter((group) => group.models.length > 0));
  const textModelGroups = computed(() => connectionProfiles.value
      .map((provider) => ({provider, models: provider.models.filter((item) => !item.isImage)}))
      .filter((group) => group.models.length > 0));
  const imageModelSelectOptions = computed(() => modelSelectOptions(imageModelGroups.value));
  const textModelSelectOptions = computed(() => modelSelectOptions(textModelGroups.value));
  const titleModelSelectOptions = computed(() => [
    {value: "current", label: "使用当前聊天模型", providerName: ""},
    {value: "none", label: "不生成标题", providerName: ""},
    ...textModelSelectOptions.value,
  ]);

  const providerList = computed<ConnectionProfile[]>(() => {
    if (!connectionDraftId.value) return connectionProfiles.value;
    if (providerDraftIsNew.value) {
      return [...connectionProfiles.value, {
        id: connectionDraftId.value,
        name: connectionDraftName.value.trim() || "新提供商",
        endpoint: connectionDraftEndpoint.value.trim(),
        imageEndpoint: connectionDraftImageEndpoint.value.trim(),
        apiKey: connectionDraftApiKey.value,
        models: [],
      }];
    }
    return connectionProfiles.value.map((provider) => provider.id === connectionDraftId.value
        ? {
          ...provider,
          name: connectionDraftName.value.trim() || "未命名提供商",
          endpoint: connectionDraftEndpoint.value,
          imageEndpoint: connectionDraftImageEndpoint.value,
          apiKey: connectionDraftApiKey.value,
        }
        : provider);
  });
  const selectedProvider = computed(() => providerList.value.find(
      (provider) => provider.id === selectedProviderId.value
  ) ?? providerList.value[0]);
  const hasUnsavedProviderChanges = computed(() => {
    if (!connectionDraftId.value) return false;
    if (providerDraftIsNew.value) return true;
    const provider = connectionProfiles.value.find((item) => item.id === connectionDraftId.value);
    return Boolean(provider && (
      connectionDraftName.value !== provider.name ||
      connectionDraftEndpoint.value !== provider.endpoint ||
      connectionDraftImageEndpoint.value !== provider.imageEndpoint ||
      connectionDraftApiKey.value !== provider.apiKey
    ));
  });

  let unsavedChangesResolver: ((decision: UnsavedChangesDecision) => void) | null = null;
  let pendingUnsavedChangesDecision: Promise<UnsavedChangesDecision> | null = null;

  function resolveModelSelection(value: string): ResolvedModel | null {
    return resolveSelection(value, connectionProfiles.value);
  }

  function firstModelSelection(image: boolean): string {
    const group = (image ? imageModelGroups.value : textModelGroups.value)[0];
    const firstModel = group?.models[0];
    return group && firstModel ? modelSelectionKey(group.provider.id, firstModel.id) : "";
  }

  function ensureModelSelections() {
    const selectedImage = resolveModelSelection(imageModelSelection.value);
    if (!selectedImage?.model.isImage) imageModelSelection.value = firstModelSelection(true);
    const selectedText = resolveModelSelection(chatModelSelection.value);
    if (!selectedText || selectedText.model.isImage) chatModelSelection.value = firstModelSelection(false);
    const titleModel = resolveModelSelection(titleModelSelection.value);
    if (!["current", "none"].includes(titleModelSelection.value) && (!titleModel || titleModel.model.isImage)) {
      titleModelSelection.value = "current";
    }
    const imageResolved = resolveModelSelection(imageModelSelection.value);
    const textResolved = resolveModelSelection(chatModelSelection.value);
    if (imageResolved) model.value = imageResolved.model.id;
    if (textResolved) textModel.value = textResolved.model.id;
    if (!connectionProfiles.value.some((item) => item.id === selectedProviderId.value)) {
      selectedProviderId.value = connectionProfiles.value[0]?.id ?? "";
    }
  }

  function selectConnection(profile: ConnectionProfile) {
    activeConnectionId.value = profile.id;
    selectedProviderId.value = profile.id;
    endpoint.value = profile.endpoint;
    apiKey.value = profile.apiKey;
  }

  function resetConnectionDraft(profile: ConnectionProfile) {
    connectionDraftId.value = profile.id;
    connectionDraftName.value = profile.name;
    connectionDraftEndpoint.value = profile.endpoint;
    connectionDraftImageEndpoint.value = profile.imageEndpoint;
    connectionDraftApiKey.value = profile.apiKey;
    connectionDraftError.value = "";
    providerDraftIsNew.value = false;
  }

  function requestUnsavedChangesDecision(): Promise<UnsavedChangesDecision> {
    if (pendingUnsavedChangesDecision) return pendingUnsavedChangesDecision;
    unsavedChangesModalOpen.value = true;
    pendingUnsavedChangesDecision = new Promise((resolve) => { unsavedChangesResolver = resolve; });
    return pendingUnsavedChangesDecision;
  }

  function resolveUnsavedChanges(decision: UnsavedChangesDecision) {
    const resolve = unsavedChangesResolver;
    unsavedChangesResolver = null;
    pendingUnsavedChangesDecision = null;
    unsavedChangesModalOpen.value = false;
    resolve?.(decision);
  }

  function cancelConnectionDraft() {
    if (providerDraftIsNew.value) {
      const fallback = connectionProfiles.value.find((item) => item.id === providerDraftPreviousId.value)
          ?? connectionProfiles.value[0];
      if (fallback) {
        selectConnection(fallback);
        resetConnectionDraft(fallback);
      }
      return;
    }
    const provider = connectionProfiles.value.find((item) => item.id === connectionDraftId.value);
    if (provider) resetConnectionDraft(provider);
  }

  async function confirmProviderChanges(): Promise<boolean> {
    if (!hasUnsavedProviderChanges.value) return true;
    const decision = await requestUnsavedChangesDecision();
    if (decision === "cancel") return false;
    if (decision === "save") return saveConnectionDraft();
    cancelConnectionDraft();
    return true;
  }

  function warnAboutUnsavedProviderChanges(event: BeforeUnloadEvent) {
    if (!hasUnsavedProviderChanges.value) return;
    event.preventDefault();
    event.returnValue = "";
  }

  const removeProviderRouteGuard = router.beforeEach(async (to, from) =>
    to.fullPath === from.fullPath || await confirmProviderChanges()
  );

  onMounted(() => window.addEventListener("beforeunload", warnAboutUnsavedProviderChanges));
  onUnmounted(() => {
    window.removeEventListener("beforeunload", warnAboutUnsavedProviderChanges);
    removeProviderRouteGuard();
  });

  async function selectProvider(providerId: string) {
    if (providerId === selectedProviderId.value || !await confirmProviderChanges()) return;
    const provider = connectionProfiles.value.find((item) => item.id === providerId);
    if (!provider) return;
    selectConnection(provider);
    resetConnectionDraft(provider);
  }

  function addAndSelectConnection(
      endpointValue: string,
      apiKeyValue: string,
      modelsValue: Array<string | ProviderModel> = DEFAULT_CONNECTION_MODELS,
      nameValue = ""
  ) {
    if (hasUnsavedProviderChanges.value) return false;
    const profileEndpoint = endpointValue.trim();
    const profileApiKey = apiKeyValue.trim();
    if (!profileEndpoint) return false;
    const existing = connectionProfiles.value.find(
        (profile) => profile.endpoint === profileEndpoint && profile.apiKey === profileApiKey
    );
    if (existing) {
      selectConnection(existing);
      resetConnectionDraft(existing);
      return true;
    }
    const profile: ConnectionProfile = {
      id: createConnectionId(),
      name: nameValue.trim() || providerNameFromEndpoint(profileEndpoint, connectionProfiles.value.length + 1),
      endpoint: profileEndpoint,
      imageEndpoint: "",
      apiKey: profileApiKey,
      models: normalizeProviderModels(modelsValue),
    };
    connectionProfiles.value = [...connectionProfiles.value, profile];
    selectConnection(profile);
    resetConnectionDraft(profile);
    ensureModelSelections();
    return true;
  }

  async function addProviderDraft() {
    if (!await confirmProviderChanges()) return;
    providerDraftPreviousId.value = connectionProfiles.value.some(
        (item) => item.id === selectedProviderId.value
    ) ? selectedProviderId.value : connectionProfiles.value[0]?.id ?? "";
    connectionDraftId.value = createConnectionId();
    connectionDraftName.value = "";
    connectionDraftEndpoint.value = "";
    connectionDraftImageEndpoint.value = "";
    connectionDraftApiKey.value = "";
    connectionDraftError.value = "";
    providerDraftIsNew.value = true;
    selectedProviderId.value = connectionDraftId.value;
  }

  function saveConnectionDraft(): boolean {
    const profileEndpoint = connectionDraftEndpoint.value.trim();
    if (!connectionDraftName.value.trim()) {
      connectionDraftError.value = "请输入提供商名称";
      return false;
    }
    if (!profileEndpoint) {
      connectionDraftError.value = "请输入 API 地址";
      return false;
    }
    const profileApiKey = connectionDraftApiKey.value.trim();
    if (providerDraftIsNew.value) {
      const profile: ConnectionProfile = {
        id: connectionDraftId.value,
        name: connectionDraftName.value.trim(),
        endpoint: profileEndpoint,
        imageEndpoint: connectionDraftImageEndpoint.value.trim(),
        apiKey: profileApiKey,
        models: [],
      };
      connectionProfiles.value = [...connectionProfiles.value, profile];
      selectConnection(profile);
      resetConnectionDraft(profile);
    } else {
      const current = connectionProfiles.value.find((item) => item.id === connectionDraftId.value);
      if (!current) return false;
      const updated = {
        ...current,
        name: connectionDraftName.value.trim(),
        endpoint: profileEndpoint,
        imageEndpoint: connectionDraftImageEndpoint.value.trim(),
        apiKey: profileApiKey,
      };
      connectionProfiles.value = connectionProfiles.value.map(
          (profile) => profile.id === updated.id ? updated : profile
      );
      if (activeConnectionId.value === updated.id) selectConnection(updated);
      resetConnectionDraft(updated);
    }
    ensureModelSelections();
    return true;
  }

  function openModelModal(providerId: string, providerModel?: ProviderModel) {
    modelDraftProviderId.value = providerId;
    modelDraftOriginalId.value = providerModel?.id ?? "";
    modelDraftId.value = providerModel?.id ?? "";
    modelDraftDisplayName.value = providerModel?.displayName ?? "";
    modelDraftDescription.value = providerModel?.description ?? "";
    modelDraftIsImage.value = providerModel?.isImage ?? false;
    modelDraftContextLength.value = providerModel?.contextLength ?? 256000;
    modelDraftError.value = "";
    modelModalOpen.value = true;
  }

  function closeModelModal() {
    modelModalOpen.value = false;
    modelDraftProviderId.value = "";
    modelDraftOriginalId.value = "";
    modelDraftId.value = "";
    modelDraftDisplayName.value = "";
    modelDraftDescription.value = "";
    modelDraftIsImage.value = false;
    modelDraftContextLength.value = 256000;
    modelDraftError.value = "";
  }

  function saveModelDraft() {
    const provider = connectionProfiles.value.find((item) => item.id === modelDraftProviderId.value);
    const id = modelDraftId.value.trim();
    const contextLength = Number(modelDraftContextLength.value);
    if (!provider) return;
    if (!id) {
      modelDraftError.value = "请输入模型 ID";
      return;
    }
    if (provider.models.some((item) => item.id === id && item.id !== modelDraftOriginalId.value)) {
      modelDraftError.value = "该提供商中已存在相同模型 ID";
      return;
    }
    if (!Number.isInteger(contextLength) || contextLength < 1) {
      modelDraftError.value = "上下文长度必须是大于 0 的整数";
      return;
    }
    const providerModel: ProviderModel = {
      id,
      displayName: modelDraftDisplayName.value.trim(),
      description: modelDraftDescription.value.trim(),
      isImage: modelDraftIsImage.value,
      contextLength,
    };
    const previousId = modelDraftOriginalId.value;
    const models = previousId
        ? provider.models.map((item) => item.id === previousId ? providerModel : item)
        : [...provider.models, providerModel];
    connectionProfiles.value = connectionProfiles.value.map(
        (item) => item.id === provider.id ? {...item, models} : item
    );
    if (previousId && previousId !== id) {
      const oldSelection = modelSelectionKey(provider.id, previousId);
      const newSelection = modelSelectionKey(provider.id, id);
      if (imageModelSelection.value === oldSelection) imageModelSelection.value = newSelection;
      if (chatModelSelection.value === oldSelection) chatModelSelection.value = newSelection;
      if (titleModelSelection.value === oldSelection) titleModelSelection.value = newSelection;
      for (const node of options.canvasNodes.value) {
        if (node.data.connectionId === provider.id && node.data.model === previousId) {
          options.updateCanvasNodeData(node.id, {model: id});
        }
      }
    }
    ensureModelSelections();
    repairCanvasModels(provider.id, id, providerModel.isImage);
    closeModelModal();
  }

  function removeProviderModel(providerId: string, modelId: string) {
    connectionProfiles.value = connectionProfiles.value.map((item) => item.id === providerId
        ? {...item, models: item.models.filter((model) => model.id !== modelId)}
        : item
    );
    ensureModelSelections();
    repairCanvasModels(providerId, modelId);
  }

  function removeConnection(profile: ConnectionProfile) {
    if (connectionProfiles.value.length <= 1) return;
    const remaining = connectionProfiles.value.filter((item) => item.id !== profile.id);
    connectionProfiles.value = remaining;
    if (activeConnectionId.value === profile.id || selectedProviderId.value === profile.id) {
      selectConnection(remaining[0]);
      resetConnectionDraft(remaining[0]);
    }
    repairCanvasModels(profile.id, undefined, undefined, remaining[0]);
    ensureModelSelections();
  }

  function repairCanvasModels(
      providerId: string,
      modelId?: string,
      isImage?: boolean,
      providerFallback?: ConnectionProfile
  ) {
    for (const node of options.canvasNodes.value) {
      if (node.data.connectionId !== providerId || (modelId && node.data.model !== modelId)) continue;
      if (isImage !== undefined && (node.type === "image") === isImage) continue;
      const fallback = resolveModelSelection(firstModelSelection(node.type === "image"));
      options.updateCanvasNodeData(node.id, {
        connectionId: fallback?.provider.id ?? providerFallback?.id ?? "",
        model: fallback?.model.id ?? providerFallback?.models[0]?.id ?? "",
      });
    }
  }

  function initializeDraft() {
    const initial = connectionProfiles.value.find((item) => item.id === selectedProviderId.value)
        ?? connectionProfiles.value[0];
    if (initial) resetConnectionDraft(initial);
  }

  watch(imageModelSelection, (selection) => {
    const resolved = resolveModelSelection(selection);
    if (resolved?.model.isImage) model.value = resolved.model.id;
  });

  watch(chatModelSelection, (selection) => {
    const resolved = resolveModelSelection(selection);
    if (resolved && !resolved.model.isImage) textModel.value = resolved.model.id;
  });

  return {
    endpoint, apiKey, connectionProfiles, activeConnectionId, selectedProviderId,
    connectionDraftId, connectionDraftName, connectionDraftEndpoint, connectionDraftImageEndpoint,
    connectionDraftApiKey, connectionDraftError, providerDraftIsNew, providerDraftPreviousId,
    unsavedChangesModalOpen, modelModalOpen, modelDraftProviderId, modelDraftOriginalId,
    modelDraftId, modelDraftDisplayName, modelDraftDescription, modelDraftIsImage,
    modelDraftContextLength, modelDraftError, model, modelOptions, textModel, textModelOptions,
    imageModelSelection, chatModelSelection, titleModelSelection, imageModelGroups, textModelGroups,
    imageModelSelectOptions, textModelSelectOptions, titleModelSelectOptions, providerList,
    selectedProvider, hasUnsavedProviderChanges, resolveModelSelection, firstModelSelection,
    ensureModelSelections, selectConnection, initializeDraft, resolveUnsavedChanges,
    cancelConnectionDraft, confirmProviderChanges, warnAboutUnsavedProviderChanges,
    removeProviderRouteGuard, selectProvider, addAndSelectConnection, addProviderDraft,
    saveConnectionDraft, openModelModal, closeModelModal, saveModelDraft,
    removeProviderModel, removeConnection,
  };
}

export type ProviderSettings = ReturnType<typeof useProviderSettings>;

function modelSelectOptions(groups: Array<{provider: ConnectionProfile; models: ProviderModel[]}>) {
  return groups.map((group) => ({
    isGroup: true as const,
    label: group.provider.name,
    options: group.models.map((model) => ({
      value: modelSelectionKey(group.provider.id, model.id),
      label: modelDisplayName(model),
      providerName: group.provider.name,
    })),
  }));
}
