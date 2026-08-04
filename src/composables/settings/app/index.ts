import {ref, watch, type Ref} from "vue";
import {
  DEFAULT_CONNECTION_ID,
  DEFAULT_ENDPOINT,
  DEFAULT_RETRY_STATUS_CODE_OPTIONS,
  SETTINGS_KEY,
  createConnectionId,
  modelSelectionKey,
  normalizeConnectionProfiles,
  normalizeModelOptions,
  normalizeProviderModels,
  normalizeStatusCodes,
  normalizeTextModelOptions,
  providerNameFromEndpoint,
} from "../../../domain/models";
import type {ThemeMode} from "../../theme";
import type {GenerationSettings} from "../generation";
import type {ProviderSettings} from "../provider";

interface AppSettingsOptions {
  providers: ProviderSettings;
  generation: GenerationSettings;
  themeMode: Ref<ThemeMode>;
}

export function useAppSettings(options: AppSettingsOptions) {
  const autoCheckUpdate = ref(true);
  const userName = ref(createDefaultUserName());
  restore();
  options.providers.ensureModelSelections();
  options.providers.initializeDraft();

  watch(
      [
        options.providers.endpoint,
        options.providers.apiKey,
        options.providers.connectionProfiles,
        options.providers.activeConnectionId,
        options.providers.selectedProviderId,
        options.providers.model,
        options.providers.modelOptions,
        options.generation.apiMode,
        options.generation.retryEnabled,
        options.generation.retryStatusCodes,
        options.generation.retryStatusCodeOptions,
        options.generation.retryCount,
        autoCheckUpdate,
        userName,
        options.themeMode,
        options.generation.size,
        options.generation.customWidth,
        options.generation.customHeight,
        options.generation.count,
        options.providers.textModel,
        options.providers.textModelOptions,
        options.providers.imageModelSelection,
        options.providers.chatModelSelection,
        options.providers.titleModelSelection,
      ],
      persist,
      {deep: true, immediate: true}
  );

  function restore() {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (!saved) return;
    try {
      const settings = JSON.parse(saved);
      const savedEndpoint = typeof settings.endpoint === "string" && settings.endpoint.trim()
          ? settings.endpoint.trim()
          : DEFAULT_ENDPOINT;
      const savedApiKey = typeof settings.apiKey === "string" ? settings.apiKey.trim() : "";
      const fallbackModels = [...new Set([
        ...(Array.isArray(settings.modelOptions) ? settings.modelOptions : []),
        ...(Array.isArray(settings.textModelOptions) ? settings.textModelOptions : []),
        ...(typeof settings.model === "string" ? [settings.model] : []),
        ...(typeof settings.textModel === "string" ? [settings.textModel] : []),
      ].filter((item): item is string => typeof item === "string" && item.trim().length > 0))];
      const restoredProfiles = normalizeConnectionProfiles(settings.connectionProfiles, fallbackModels);
      if (restoredProfiles.length === 0) {
        restoredProfiles.push({
          id: savedEndpoint === DEFAULT_ENDPOINT && !savedApiKey
              ? DEFAULT_CONNECTION_ID
              : createConnectionId(),
          name: providerNameFromEndpoint(savedEndpoint, 1),
          endpoint: savedEndpoint,
          imageEndpoint: "",
          apiKey: savedApiKey,
          models: normalizeProviderModels(fallbackModels),
        });
      }
      options.providers.connectionProfiles.value = restoredProfiles;
      const savedActiveId = typeof settings.activeConnectionId === "string"
          ? settings.activeConnectionId
          : "";
      const activeProfile = restoredProfiles.find((profile) => profile.id === savedActiveId)
          ?? restoredProfiles.find(
              (profile) => profile.endpoint === savedEndpoint && profile.apiKey === savedApiKey
          )
          ?? restoredProfiles[0];
      options.providers.selectConnection(activeProfile);
      options.providers.model.value = settings.model ?? options.providers.model.value;
      options.providers.modelOptions.value = normalizeModelOptions(settings.modelOptions);
      const savedModel = options.providers.model.value.trim();
      if (savedModel && !options.providers.modelOptions.value.includes(savedModel)) {
        options.providers.modelOptions.value = [...options.providers.modelOptions.value, savedModel];
      }
      options.generation.apiMode.value = ["auto", "images", "chat"].includes(settings.apiMode)
          ? settings.apiMode
          : "auto";
      options.generation.retryEnabled.value = settings.retryEnabled ?? false;
      options.generation.retryStatusCodes.value = normalizeStatusCodes(settings.retryStatusCodes) ?? [504];
      options.generation.retryStatusCodeOptions.value = [
        ...new Set([
          ...DEFAULT_RETRY_STATUS_CODE_OPTIONS,
          ...(normalizeStatusCodes(settings.retryStatusCodeOptions) ?? []),
          ...options.generation.retryStatusCodes.value,
        ]),
      ].sort((left, right) => left - right);
      options.generation.retryCount.value = settings.retryCount ?? 5;
      autoCheckUpdate.value = settings.autoCheckUpdate ?? true;
      userName.value = typeof settings.userName === "string" && settings.userName.trim()
          ? settings.userName.trim().slice(0, 64)
          : userName.value;
      options.generation.size.value = typeof settings.size === "string" && [
        "auto",
        "1024x1024",
        "1536x1024",
        "1024x1536",
        "custom",
      ].includes(settings.size) ? settings.size : "auto";
      options.generation.customWidth.value = Number.isInteger(settings.customWidth)
          && settings.customWidth > 0 ? settings.customWidth : 1024;
      options.generation.customHeight.value = Number.isInteger(settings.customHeight)
          && settings.customHeight > 0 ? settings.customHeight : 1024;
      options.generation.count.value = Number.isInteger(settings.count)
          && settings.count >= 1 && settings.count <= 10 ? settings.count : 1;
      options.providers.textModel.value = typeof settings.textModel === "string"
          && settings.textModel.trim() ? settings.textModel.trim() : options.providers.textModel.value;
      options.providers.textModelOptions.value = normalizeTextModelOptions(settings.textModelOptions);
      if (
        options.providers.textModel.value
        && !options.providers.textModelOptions.value.includes(options.providers.textModel.value)
      ) {
        options.providers.textModelOptions.value = [
          ...options.providers.textModelOptions.value,
          options.providers.textModel.value,
        ];
      }
      options.providers.selectedProviderId.value = typeof settings.selectedProviderId === "string"
          ? settings.selectedProviderId
          : activeProfile.id;
      options.providers.imageModelSelection.value = typeof settings.imageModelSelection === "string"
          ? settings.imageModelSelection
          : modelSelectionKey(activeProfile.id, options.providers.model.value);
      options.providers.chatModelSelection.value = typeof settings.chatModelSelection === "string"
          ? settings.chatModelSelection
          : modelSelectionKey(activeProfile.id, options.providers.textModel.value);
      options.providers.titleModelSelection.value = typeof settings.titleModelSelection === "string"
          ? settings.titleModelSelection
          : "current";
    } catch {
    }
  }

  function persist() {
    const providers = options.providers;
    const generation = options.generation;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      endpoint: providers.endpoint.value,
      apiKey: providers.apiKey.value,
      connectionProfiles: providers.connectionProfiles.value,
      activeConnectionId: providers.activeConnectionId.value,
      selectedProviderId: providers.connectionProfiles.value.some(
          (profile) => profile.id === providers.selectedProviderId.value
      ) ? providers.selectedProviderId.value : providers.providerDraftPreviousId.value,
      model: providers.model.value,
      modelOptions: providers.modelOptions.value,
      apiMode: generation.apiMode.value,
      retryEnabled: generation.retryEnabled.value,
      retryStatusCodes: generation.retryStatusCodes.value,
      retryStatusCodeOptions: generation.retryStatusCodeOptions.value,
      retryCount: generation.retryCount.value,
      autoCheckUpdate: autoCheckUpdate.value,
      userName: userName.value.trim().slice(0, 64),
      themeMode: options.themeMode.value,
      size: generation.size.value,
      customWidth: generation.customWidth.value,
      customHeight: generation.customHeight.value,
      count: generation.count.value,
      textModel: providers.textModel.value,
      textModelOptions: providers.textModelOptions.value,
      imageModelSelection: providers.imageModelSelection.value,
      chatModelSelection: providers.chatModelSelection.value,
      titleModelSelection: providers.titleModelSelection.value,
    }));
  }

  return {autoCheckUpdate, userName};
}

function createDefaultUserName(): string {
  const suffix = Math.floor(Math.random() * 10000).toString().padStart(4, "0");
  return `用户${suffix}`;
}
