<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import type {
    JobApplication,
    ClassifierConnectionTestResponse,
    CodexConnectionStatus,
    EmailAutomationQueueItem,
    GmailAutomationStatus,
} from "@jobapp/shared";
import { formatRelativeTime } from "../utils";

const props = defineProps<{
    applications: JobApplication[];
}>();

const emit = defineEmits<{
    (e: "applications-changed"): void;
}>();

const status = ref<GmailAutomationStatus | null>(null);
const codexStatus = ref<CodexConnectionStatus | null>(null);
const queue = ref<EmailAutomationQueueItem[]>([]);
const loading = ref(false);
const testingConnection = ref(false);
const message = ref("");
const linkTargets = ref<Record<string, string>>({});
const popupRefreshPolls = new Set<number>();
const authStatusPolls = new Map<string, number>();

const classifierProvider = ref<"nim" | "codex">("nim");
const modelPreset = ref("");
const customModelValue = ref("");
const customModelActive = ref(false);
const nimApiKeyValue = ref("");

const nimPresets = [
    { value: "meta/llama-3.1-405b-instruct", label: "Llama 3.1 405B" },
    { value: "meta/llama-3.1-70b-instruct", label: "Llama 3.1 70B" },
    { value: "meta/llama-3.1-8b-instruct", label: "Llama 3.1 8B" },
    { value: "nvidia/llama-3.1-nemotron-70b-instruct", label: "Nemotron 70B" },
    { value: "mistralai/mixtral-8x22b-instruct-v0.1", label: "Mixtral 8x22B" },
    { value: "custom", label: "Custom Model..." },
];

const codexPresets = [
    { value: "openai/gpt-5.5", label: "GPT-5.5 (Default)" },
    { value: "openai/gpt-5.4", label: "GPT-5.4" },
    { value: "openai/gpt-5.4-mini", label: "GPT-5.4-mini" },
    { value: "custom", label: "Custom Model..." },
];

watch(
    status,
    (newStatus) => {
        if (newStatus) {
            nimApiKeyValue.value = newStatus.nimApiKey || "";
            const prov = newStatus.classifierProvider || "nim";
            classifierProvider.value = prov;

            const model =
                newStatus.classifierModel ||
                (prov === "codex" ? "openai/gpt-5.5" : "meta/llama-3.1-405b-instruct");
            const presets = prov === "codex" ? codexPresets : nimPresets;
            const foundPreset = presets.find((p) => p.value === model);
            if (foundPreset) {
                modelPreset.value = model;
                customModelActive.value = false;
            } else {
                modelPreset.value = "custom";
                customModelValue.value = model;
                customModelActive.value = true;
            }
        }
    },
    { immediate: true },
);

watch(classifierProvider, (newProv) => {
    const presets = newProv === "codex" ? codexPresets : nimPresets;
    if (modelPreset.value !== "custom") {
        const exists = presets.some((p) => p.value === modelPreset.value);
        if (!exists) {
            modelPreset.value = presets[0].value;
            customModelActive.value = false;
        }
    }
});

const selectedClassifierModel = computed(() =>
    modelPreset.value === "custom"
        ? customModelValue.value.trim()
        : modelPreset.value,
);

const canTestClassifierConnection = computed(
    () => Boolean(selectedClassifierModel.value) && !loading.value && !testingConnection.value,
);

async function saveClassifierSettings() {
    loading.value = true;
    message.value = "";
    try {
        const finalModel = selectedClassifierModel.value;
        if (!finalModel) {
            throw new Error("Model name cannot be empty.");
        }

        status.value = await fetchJson<GmailAutomationStatus>(
            "/api/automation/settings",
            {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    classifierProvider: classifierProvider.value,
                    classifierModel: finalModel,
                    nimApiKey:
                        classifierProvider.value === "nim"
                            ? nimApiKeyValue.value.trim()
                            : undefined,
                }),
            },
        );
        message.value = "AI Classifier settings saved successfully.";
    } catch (error: any) {
        message.value = error.message;
        await refreshAutomation().catch(() => undefined);
    } finally {
        loading.value = false;
    }
}

async function testClassifierConnection() {
    testingConnection.value = true;
    message.value = "";
    try {
        const finalModel = selectedClassifierModel.value;
        if (!finalModel) {
            throw new Error("Model name cannot be empty.");
        }

        const result = await fetchJson<ClassifierConnectionTestResponse>(
            "/api/automation/test-classifier",
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    classifierProvider: classifierProvider.value,
                    classifierModel: finalModel,
                    nimApiKey:
                        classifierProvider.value === "nim"
                            ? nimApiKeyValue.value.trim()
                            : undefined,
                }),
            },
        );
        message.value = result.message;
    } catch (error: any) {
        message.value = error.message;
        await refreshAutomation().catch(() => undefined);
    } finally {
        testingConnection.value = false;
    }
}

const pendingQueue = computed(() =>
    queue.value.filter((item) => item.status === "pending"),
);
const resolvedQueue = computed(() =>
    queue.value.filter((item) => item.status !== "pending").slice(0, 8),
);

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await fetch(url, init);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data.error || res.statusText);
    }
    return data as T;
}

async function refreshAutomation() {
    const [nextStatus, nextCodexStatus, nextQueue] = await Promise.all([
        fetchJson<GmailAutomationStatus>("/api/automation/status"),
        fetchJson<CodexConnectionStatus>("/api/codex/status"),
        fetchJson<EmailAutomationQueueItem[]>("/api/automation/queue"),
    ]);
    status.value = nextStatus;
    codexStatus.value = nextCodexStatus;
    queue.value = nextQueue;
}

function isProviderConnected(label: string) {
    return label === "Gmail"
        ? Boolean(status.value?.gmailConnected)
        : Boolean(codexStatus.value?.codexConnected);
}

function clearAuthStatusPoll(label: string) {
    const poll = authStatusPolls.get(label);
    if (poll === undefined) return;
    window.clearInterval(poll);
    authStatusPolls.delete(label);
}

function waitForAuthorizationStatus(label: string) {
    clearAuthStatusPoll(label);
    const startedAt = Date.now();
    const poll = window.setInterval(() => {
        refreshAutomation()
            .then(() => {
                if (isProviderConnected(label)) {
                    clearAuthStatusPoll(label);
                    message.value = `${label} connected successfully.`;
                    return;
                }

                if (Date.now() - startedAt > 30_000) {
                    clearAuthStatusPoll(label);
                    message.value = `${label} authorization did not finish yet. Complete the popup flow or close it to refresh.`;
                }
            })
            .catch((error) => {
                clearAuthStatusPoll(label);
                message.value = `${label} authorization refresh failed: ${error.message}`;
            });
    }, 1000);
    authStatusPolls.set(label, poll);
}

function refreshWhenPopupCloses(popup: Window, label: string) {
    const poll = window.setInterval(() => {
        if (!popup.closed) return;

        window.clearInterval(poll);
        popupRefreshPolls.delete(poll);
        clearAuthStatusPoll(label);
        refreshAutomation()
            .then(() => {
                message.value = isProviderConnected(label)
                    ? `${label} connected successfully.`
                    : `${label} authorization finished, but ${label} is still not connected. Check OAuth config and try again.`;
            })
            .catch((error) => {
                message.value = `${label} authorization finished, but refresh failed: ${error.message}`;
            });
    }, 1000);
    popupRefreshPolls.add(poll);
}

async function openAuthorizationPopup(endpoint: string, label: string) {
    const popup = window.open("", "_blank", "popup");
    if (!popup) {
        message.value = `${label} popup was blocked. Allow popups for this site and try again.`;
        return;
    }

    try {
        const data = await fetchJson<{ authUrl: string }>(endpoint);
        popup.location.href = data.authUrl;
        refreshWhenPopupCloses(popup, label);
        waitForAuthorizationStatus(label);
        message.value = `${label} authorization opened. Complete the popup flow to connect.`;
    } catch (error: any) {
        popup.close();
        message.value = `${label} authorization failed: ${error.message}`;
        await refreshAutomation().catch(() => undefined);
    }
}

async function connectGmail() {
    await openAuthorizationPopup("/api/gmail/connect", "Gmail");
}

async function connectCodex() {
    await openAuthorizationPopup("/api/codex/connect", "ChatGPT Plus");
}

async function importCodexCliAuth() {
    loading.value = true;
    message.value = "";
    try {
        codexStatus.value = await fetchJson<CodexConnectionStatus>(
            "/api/codex/import-cli-auth",
            {
                method: "POST",
            },
        );
        message.value = "Imported local Codex CLI auth successfully.";
        await refreshAutomation();
    } catch (error: any) {
        message.value = error.message;
        await refreshAutomation().catch(() => undefined);
    } finally {
        loading.value = false;
    }
}
async function runScan() {
    loading.value = true;
    message.value = "";
    startScanPolling();
    try {
        const result = await fetchJson<{ processed: number }>(
            "/api/automation/scan",
            { method: "POST" },
        );
        message.value = `Scan completed: ${result.processed} messages checked.`;
        emit("applications-changed");
    } catch (error: any) {
        message.value = error.message;
    } finally {
        await refreshAutomation().catch(() => undefined);
        loading.value = false;
    }
}

async function abortScan() {
    loading.value = true;
    message.value = "";
    try {
        await fetchJson<{ status: string }>("/api/automation/abort-scan", {
            method: "POST",
        });
        message.value = "Abort request sent.";
        await refreshAutomation();
    } catch (error: any) {
        message.value = error.message;
    } finally {
        loading.value = false;
    }
}

async function setPollingEnabled(enabled: boolean) {
    loading.value = true;
    message.value = "";
    try {
        status.value = await fetchJson<GmailAutomationStatus>(
            "/api/automation/settings",
            {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ pollingEnabled: enabled }),
            },
        );
        message.value = enabled
            ? "Polling enabled."
            : "Polling disabled. Manual scan is still available.";
    } catch (error: any) {
        message.value = error.message;
        await refreshAutomation().catch(() => undefined);
    } finally {
        loading.value = false;
    }
}

async function applyItem(item: EmailAutomationQueueItem) {
    loading.value = true;
    try {
        await fetchJson(`/api/automation/queue/${item.id}/apply`, {
            method: "POST",
        });
        message.value = "Queue item applied.";
        await refreshAutomation();
        emit("applications-changed");
    } catch (error: any) {
        message.value = error.message;
    } finally {
        loading.value = false;
    }
}

async function ignoreItem(item: EmailAutomationQueueItem) {
    loading.value = true;
    try {
        await fetchJson(`/api/automation/queue/${item.id}/ignore`, {
            method: "POST",
        });
        message.value = "Queue item ignored.";
        await refreshAutomation();
    } catch (error: any) {
        message.value = error.message;
    } finally {
        loading.value = false;
    }
}

async function linkItem(item: EmailAutomationQueueItem) {
    const applicationId = linkTargets.value[item.id];
    if (!applicationId) {
        message.value = "Select an application first.";
        return;
    }

    loading.value = true;
    try {
        await fetchJson(`/api/automation/queue/${item.id}/link`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ applicationId }),
        });
        message.value = "Queue item linked.";
        await refreshAutomation();
        emit("applications-changed");
    } catch (error: any) {
        message.value = error.message;
    } finally {
        loading.value = false;
    }
}

const scanPollInterval = ref<number | null>(null);

const progressPercentage = computed(() => {
    if (!status.value || !status.value.scanProgressTotal) return 0;
    return Math.min(
        100,
        Math.round(((status.value.scanProgressProcessed || 0) / status.value.scanProgressTotal) * 100)
    );
});

function startScanPolling() {
    if (!scanPollInterval.value) {
        scanPollInterval.value = window.setInterval(async () => {
            await refreshAutomation().catch(() => undefined);
        }, 1200);
    }
}

function stopScanPolling() {
    if (scanPollInterval.value) {
        window.clearInterval(scanPollInterval.value);
        scanPollInterval.value = null;
    }
}

watch(
    () => status.value?.lastScanStatus,
    (newVal) => {
        if (newVal === "running") {
            startScanPolling();
        } else {
            stopScanPolling();
        }
    }
);

function confidencePercent(item: EmailAutomationQueueItem): string {
    return `${Math.round(item.decision.confidence * 100)}%`;
}

onMounted(() => {
    refreshAutomation().catch((error) => {
        message.value = error.message;
    });
});

onUnmounted(() => {
    stopScanPolling();
    for (const poll of popupRefreshPolls) {
        window.clearInterval(poll);
    }
    popupRefreshPolls.clear();

    for (const poll of authStatusPolls.values()) {
        window.clearInterval(poll);
    }
    authStatusPolls.clear();
});
</script>

<template>
    <section class="automation-view" aria-label="Email automation">
        <div class="status-grid">
            <div class="status-panel">
                <span class="panel-label">Gmail</span>
                <strong :class="status?.gmailConnected ? 'ok' : 'warn'">
                    {{ status?.gmailConnected ? "Connected" : "Not connected" }}
                </strong>
                <button type="button" class="small-btn" @click="connectGmail">
                    <iconify-icon icon="solar:link-round-linear"></iconify-icon>
                    <span>Connect</span>
                </button>
                <span class="muted">
                    {{
                        status?.gmailConfigured
                            ? status?.hasRefreshToken
                                ? "Refresh token stored"
                                : "Gmail OAuth ready"
                            : "Gmail OAuth missing config"
                    }}
                </span>
            </div>

            <div class="status-panel">
                <span class="panel-label">ChatGPT Plus</span>
                <strong :class="codexStatus?.codexConnected ? 'ok' : 'warn'">
                    {{
                        codexStatus?.codexConnected
                            ? "Connected"
                            : "Not connected"
                    }}
                </strong>
                <div class="codex-actions">
                    <button
                        type="button"
                        class="small-btn"
                        :disabled="loading"
                        @click="connectCodex"
                    >
                        <iconify-icon
                            icon="solar:link-round-linear"
                        ></iconify-icon>
                        <span>Connect</span>
                    </button>
                    <button
                        type="button"
                        class="small-btn"
                        :disabled="loading"
                        @click="importCodexCliAuth"
                    >
                        <iconify-icon
                            icon="solar:download-minimalistic-linear"
                        ></iconify-icon>
                        <span>Import CLI Auth</span>
                    </button>
                </div>
                <span class="muted">
                    {{
                        codexStatus?.chatgptPlanType ||
                        codexStatus?.chatgptAccountId ||
                        (codexStatus?.codexConfigured
                            ? "Codex OAuth ready"
                            : "Codex OAuth missing config")
                    }}
                </span>
                <span v-if="codexStatus?.lastError" class="muted error-text">{{
                    codexStatus.lastError
                }}</span>
            </div>

            <div class="status-panel">
                <span class="panel-label">Polling</span>
                <strong :class="status?.schedulerEnabled ? 'ok' : 'warn'">
                    {{ status?.schedulerEnabled ? "Enabled" : "Disabled" }}
                </strong>
                <label class="polling-toggle">
                    <span>{{
                        status?.pollIntervalMs
                            ? `${Math.round(status.pollIntervalMs / 60000)}m interval`
                            : "-"
                    }}</span>
                    <button
                        type="button"
                        class="toggle-switch-btn"
                        :class="{ active: status?.schedulerEnabled }"
                        :disabled="loading || !status"
                        role="switch"
                        :aria-checked="Boolean(status?.schedulerEnabled)"
                        aria-label="Enable Gmail polling"
                        @click="setPollingEnabled(!status?.schedulerEnabled)"
                    >
                        <span class="toggle-switch-thumb"></span>
                    </button>
                </label>
            </div>

            <div class="status-panel classifier-settings-panel">
                <span class="panel-label">AI Classifier Settings</span>
                <div class="settings-form">
                    <div class="form-row">
                        <div class="form-group flex-1">
                            <label for="provider-select">Provider</label>
                            <select
                                id="provider-select"
                                v-model="classifierProvider"
                                :disabled="loading"
                                class="form-select"
                            >
                                <option value="nim">NVIDIA NIM</option>
                                <option value="codex">ChatGPT Plus</option>
                            </select>
                        </div>

                        <div class="form-group flex-1">
                            <label for="model-preset">Model</label>
                            <select
                                id="model-preset"
                                v-model="modelPreset"
                                :disabled="loading"
                                class="form-select"
                            >
                                <option
                                    v-for="preset in classifierProvider === 'codex' ? codexPresets : nimPresets"
                                    :key="preset.value"
                                    :value="preset.value"
                                >
                                    {{ preset.label }}
                                </option>
                            </select>
                        </div>
                    </div>

                    <div v-if="modelPreset === 'custom'" class="form-group">
                        <label for="custom-model">Custom Model ID</label>
                        <input
                            id="custom-model"
                            v-model="customModelValue"
                            type="text"
                            :disabled="loading"
                            placeholder="e.g. meta/llama-3-70b-instruct"
                            class="form-input"
                        />
                    </div>

                    <div v-if="classifierProvider === 'nim'" class="form-group">
                        <label for="nim-api-key">NIM API key</label>
                        <input
                            id="nim-api-key"
                            v-model="nimApiKeyValue"
                            type="password"
                            :disabled="loading"
                            placeholder="nvidia..."
                            class="form-input"
                        />
                    </div>

                    <div class="provider-status-row">
                        <span
                            v-if="classifierProvider === 'nim'"
                            class="provider-status"
                            :class="status?.nimConfigured ? 'connected' : 'disconnected'"
                        >
                            <span class="status-dot"></span>
                            {{ status?.nimConfigured ? "Connected" : "Not configured" }}
                        </span>
                        <span
                            v-else
                            class="provider-status"
                            :class="codexStatus?.codexConnected ? 'connected' : 'disconnected'"
                        >
                            <span class="status-dot"></span>
                            {{ codexStatus?.codexConnected ? "Connected" : "Not connected" }}
                        </span>
                        <div class="status-actions">
                            <button
                                type="button"
                                class="small-btn"
                                :disabled="!canTestClassifierConnection"
                                @click="testClassifierConnection"
                            >
                                <iconify-icon icon="solar:check-circle-linear"></iconify-icon>
                                <span>{{ testingConnection ? "Testing" : "Test" }}</span>
                            </button>
                            <button
                                type="button"
                                class="small-btn primary"
                                :disabled="loading || testingConnection"
                                @click="saveClassifierSettings"
                            >
                                <iconify-icon icon="solar:diskette-linear"></iconify-icon>
                                <span>Save</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <div class="status-panel">
                <span class="panel-label">Last scan</span>
                <strong
                    v-if="status?.lastScanStatus === 'running'"
                    class="info-text"
                >
                    Scanning ({{ progressPercentage }}%)
                </strong>
                <strong
                    v-else
                    :class="status?.lastScanStatus === 'failed' ? 'warn' : 'ok'"
                >
                    {{
                        status?.lastScanAt
                            ? formatRelativeTime(status.lastScanAt)
                            : "Never"
                    }}
                </strong>
                <button
                    type="button"
                    class="small-btn primary"
                    :disabled="loading || status?.lastScanStatus === 'running'"
                    @click="runScan"
                >
                    <iconify-icon 
                        icon="solar:refresh-linear"
                        :class="{ spinning: loading || status?.lastScanStatus === 'running' }"
                    ></iconify-icon>
                    <span>{{ (loading || status?.lastScanStatus === 'running') ? "Scanning..." : "Run scan" }}</span>
                </button>
                <button
                    v-if="status?.lastScanStatus === 'running'"
                    type="button"
                    class="small-btn danger"
                    @click="abortScan"
                >
                    <iconify-icon icon="solar:stop-circle-linear"></iconify-icon>
                    <span>Abort scan</span>
                </button>
            </div>
        </div>

        <div class="status-strip">
            <span
                >{{ status?.pendingQueueCount ?? 0 }} queue items pending</span
            >
            <span
                >{{ status?.processedMessageCount ?? 0 }} messages
                processed</span
            >
            <span>Manual scan works independently from polling.</span>
        </div>

        <!-- Scan Progress Panel -->
        <div v-if="status?.lastScanStatus === 'running'" class="scan-progress-panel">
            <div class="progress-info">
                <div class="progress-title">
                    <iconify-icon icon="solar:bolt-circle-linear" class="pulse-icon"></iconify-icon>
                    <span>Scanning Gmail Inbox...</span>
                </div>
                <span class="progress-count" v-if="status.scanProgressTotal">
                    {{ status.scanProgressProcessed }} / {{ status.scanProgressTotal }} processed
                </span>
                <span class="progress-count" v-else>
                    Initializing scan...
                </span>
            </div>
            <div class="progress-bar-container">
                <div 
                    class="progress-bar" 
                    :style="{ width: progressPercentage + '%' }"
                ></div>
            </div>
        </div>

        <p v-if="message" class="automation-message">{{ message }}</p>
        <p v-if="status?.lastScanError" class="automation-message error">
            {{ status.lastScanError }}
        </p>

        <div class="queue-section">
            <header class="section-header">
                <h2>Review Queue</h2>
                <span>{{ pendingQueue.length }} pending</span>
            </header>

            <div v-if="pendingQueue.length === 0" class="empty-state-panel">
                <iconify-icon icon="solar:inbox-line-linear"></iconify-icon>
                <span>No pending email decisions.</span>
            </div>

            <article
                v-for="item in pendingQueue"
                :key="item.id"
                class="queue-item"
            >
                <div class="queue-main">
                    <div class="queue-title">
                        <strong>{{
                            item.decision.company || "Unknown company"
                        }}</strong>
                        <span>{{
                            item.decision.role || item.evidence.subject
                        }}</span>
                    </div>
                    <div class="queue-meta">
                        <span>{{ item.decision.category }}</span>
                        <span>{{ confidencePercent(item) }}</span>
                        <span>{{
                            item.evidence.senderDomain || item.evidence.sender
                        }}</span>
                        <span>{{ formatRelativeTime(item.createdAt) }}</span>
                    </div>
                    <p>{{ item.decision.reason }}</p>
                    <p class="evidence-line">{{ item.evidence.subject }}</p>
                </div>

                <div class="queue-actions">
                    <button
                        type="button"
                        class="small-btn primary"
                        :disabled="loading"
                        @click="applyItem(item)"
                    >
                        <iconify-icon
                            icon="solar:check-circle-linear"
                        ></iconify-icon>
                        <span>Apply</span>
                    </button>
                    <button
                        type="button"
                        class="small-btn"
                        :disabled="loading"
                        @click="ignoreItem(item)"
                    >
                        <iconify-icon
                            icon="solar:close-circle-linear"
                        ></iconify-icon>
                        <span>Ignore</span>
                    </button>
                    <label class="link-control">
                        <select v-model="linkTargets[item.id]">
                            <option value="">Link job</option>
                            <option
                                v-for="application in props.applications"
                                :key="application.id"
                                :value="application.id"
                            >
                                {{ application.company }} -
                                {{ application.role }}
                            </option>
                        </select>
                        <button
                            type="button"
                            class="icon-btn"
                            :disabled="loading || !linkTargets[item.id]"
                            @click="linkItem(item)"
                        >
                            <iconify-icon
                                icon="solar:link-linear"
                            ></iconify-icon>
                        </button>
                    </label>
                </div>
            </article>
        </div>

        <div class="queue-section resolved">
            <header class="section-header">
                <h2>Recent Decisions</h2>
                <span>{{ resolvedQueue.length }}</span>
            </header>
            <article
                v-for="item in resolvedQueue"
                :key="item.id"
                class="resolved-item"
            >
                <span>{{ item.status }}</span>
                <strong>{{
                    item.decision.company ||
                    item.evidence.senderDomain ||
                    "Email"
                }}</strong>
                <span>{{ item.decision.category }}</span>
                <span>{{ formatRelativeTime(item.updatedAt) }}</span>
            </article>
        </div>
    </section>
</template>

<style scoped>
.automation-view {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    min-height: 0;
}

.status-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0.75rem;
}

.classifier-settings-panel {
    grid-column: span 2;
    min-height: 9.5rem;
}

.codex-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
}

.settings-form {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-top: 0.25rem;
}

.form-row {
    display: flex;
    gap: 0.5rem;
}

.provider-status-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 0.25rem;
    padding-top: 0.5rem;
    border-top: 1px solid #1f1f1f;
}

.provider-status {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.75rem;
    font-weight: 500;
}

.provider-status.connected {
    color: #10b981;
}

.provider-status.disconnected {
    color: #f59e0b;
}

.status-dot {
    width: 0.45rem;
    height: 0.45rem;
    border-radius: 50%;
    background: currentColor;
    flex-shrink: 0;
}

.status-actions {
    display: flex;
    gap: 0.4rem;
}

.flex-1 {
    flex: 1;
}

.form-group {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
}

.form-group label {
    font-size: 0.7rem;
    font-weight: 500;
    color: #a3a3a3;
    text-transform: uppercase;
    letter-spacing: 0.05em;
}

.form-select,
.form-input {
    min-height: 2rem;
    background: #121212;
    border: 1px solid #262626;
    border-radius: 0.375rem;
    color: #e5e5e5;
    padding: 0 0.5rem;
    font-size: 0.8rem;
    width: 100%;
    outline: none;
    transition: border-color 0.15s ease;
}

.form-select:focus,
.form-input:focus {
    border-color: #525252;
}

.status-panel,
.queue-item,
.empty-state-panel,
.resolved-item {
    background: rgba(23, 23, 23, 0.5);
    border: 1px solid #262626;
    border-radius: 0.5rem;
}

.status-panel {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    min-height: 7rem;
    padding: 1rem;
}

.panel-label,
.muted,
.queue-meta,
.resolved-item,
.evidence-line {
    color: #737373;
    font-size: 0.75rem;
}

.status-panel strong {
    color: #f5f5f5;
    font-size: 1rem;
}

.status-panel strong.ok {
    color: #10b981;
}

.status-panel strong.warn {
    color: #f59e0b;
}

.status-strip {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    color: #737373;
    font-size: 0.78rem;
}

.small-btn,
.icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    border: 1px solid #404040;
    background: #171717;
    color: #d4d4d4;
    border-radius: 0.375rem;
    min-height: 2rem;
    padding: 0 0.65rem;
    font-size: 0.78rem;
    font-weight: 600;
}

.small-btn.primary,
.icon-btn:hover:not(:disabled) {
    border-color: rgba(59, 130, 246, 0.35);
    background: rgba(59, 130, 246, 0.12);
    color: #93c5fd;
}

.small-btn.danger {
    border-color: rgba(239, 68, 68, 0.35);
    background: rgba(239, 68, 68, 0.12);
    color: #fca5a5;
}

.small-btn.danger:hover:not(:disabled) {
    background: rgba(239, 68, 68, 0.2);
    border-color: rgba(239, 68, 68, 0.5);
}

.small-btn:disabled,
.icon-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.polling-toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    color: #737373;
    font-size: 0.75rem;
}

.toggle-switch-btn {
    position: relative;
    width: 2.35rem;
    height: 1.25rem;
    background: #262626;
    border: 1px solid #404040;
    border-radius: 999px;
    padding: 0;
}

.toggle-switch-btn.active {
    background: #10b981;
    border-color: rgba(16, 185, 129, 0.35);
}

.toggle-switch-btn:disabled {
    opacity: 0.55;
}

.toggle-switch-thumb {
    position: absolute;
    top: 1px;
    left: 1px;
    width: 1rem;
    height: 1rem;
    background: #d4d4d4;
    border-radius: 999px;
    transition: transform 180ms ease;
}

.toggle-switch-btn.active .toggle-switch-thumb {
    transform: translateX(1.1rem);
    background: #ffffff;
}

.automation-message {
    margin: 0;
    color: #a3a3a3;
    font-size: 0.85rem;
}

.automation-message.error,
.error-text {
    color: #f43f5e;
}

.queue-section {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
}

.section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
}

.section-header h2 {
    margin: 0;
    color: #e5e5e5;
    font-size: 0.95rem;
}

.section-header span {
    color: #737373;
    font-size: 0.75rem;
}

.empty-state-panel {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    min-height: 8rem;
    color: #737373;
}

.queue-item {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 1rem;
    padding: 1rem;
}

.queue-title {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    min-width: 0;
}

.queue-title strong,
.resolved-item strong {
    color: #f5f5f5;
}

.queue-title span,
.queue-main p {
    color: #a3a3a3;
}

.queue-title span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.queue-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.4rem;
}

.queue-main p {
    margin: 0.65rem 0 0;
    font-size: 0.84rem;
}

.queue-main .evidence-line {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.queue-actions {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
}

.link-control {
    display: flex;
    align-items: center;
    gap: 0.35rem;
}

.link-control select {
    min-width: 11rem;
    max-width: 14rem;
    min-height: 2rem;
    background: #171717;
    border: 1px solid #404040;
    border-radius: 0.375rem;
    color: #d4d4d4;
    padding: 0 0.5rem;
}

.icon-btn {
    width: 2rem;
    padding: 0;
}

.resolved {
    padding-bottom: 1rem;
}

.resolved-item {
    display: grid;
    grid-template-columns: 5rem minmax(0, 1fr) 10rem 7rem;
    gap: 0.75rem;
    align-items: center;
    min-height: 2.75rem;
    padding: 0 0.75rem;
}

.scan-progress-panel {
    padding: 1.25rem;
    background: rgba(16, 185, 129, 0.03);
    border: 1px solid rgba(16, 185, 129, 0.15);
    border-radius: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    margin-bottom: 0.25rem;
}

.progress-info {
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.progress-title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-weight: 500;
    color: #e5e5e5;
    font-size: 0.88rem;
}

.progress-count {
    font-size: 0.8rem;
    color: #a3a3a3;
    font-feature-settings: "tnum";
    font-weight: 500;
}

.progress-bar-container {
    width: 100%;
    height: 0.45rem;
    background: #171717;
    border-radius: 9999px;
    overflow: hidden;
    border: 1px solid #262626;
}

.progress-bar {
    height: 100%;
    background: linear-gradient(90deg, #10b981 0%, #3b82f6 100%);
    border-radius: 9999px;
    transition: width 0.3s ease-out;
}

@keyframes pulse {
    0% { opacity: 0.6; transform: scale(1); }
    50% { opacity: 1; transform: scale(1.1); }
    100% { opacity: 0.6; transform: scale(1); }
}

.pulse-icon {
    color: #10b981;
    animation: pulse 1.8s infinite ease-in-out;
    font-size: 1.1rem;
}

@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}

.spinning {
    animation: spin 1s linear infinite;
    display: inline-block;
}

.status-panel strong.info-text {
    color: #3b82f6;
    font-size: 1rem;
}

@media (max-width: 980px) {
    .status-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .queue-item {
        grid-template-columns: 1fr;
    }

    .queue-actions {
        flex-wrap: wrap;
    }
}

@media (max-width: 640px) {
    .status-grid {
        grid-template-columns: 1fr;
    }

    .resolved-item {
        grid-template-columns: 1fr;
    }

    .link-control,
    .link-control select {
        width: 100%;
    }
}
</style>
