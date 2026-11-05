import {shallowRef, type ShallowRef} from "vue";
import {
  addEdge,
  Position,
  type Connection,
  type Edge,
  type Node as FlowNode,
} from "@vue-flow/core";

export type CanvasNodeType = "text" | "image";
export type CanvasNodeStatus = "idle" | "running" | "success" | "error";
export type CanvasEdgeOrigin = "manual" | "automatic";

export interface CanvasViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface CanvasPoint {
  x: number;
  y: number;
}

export const DEFAULT_CANVAS_VIEWPORT: CanvasViewport = {x: 0, y: 0, zoom: 0.6};

export interface CanvasImageAsset {
  id: string;
  blob: Blob;
  mime: string;
  url: string;
  name: string;
}

export interface CanvasNodeData {
  title: string;
  text: string;
  outputText: string;
  prompt: string;
  references: CanvasImageAsset[];
  outputs: CanvasImageAsset[];
  size: string;
  customWidth: number;
  customHeight: number;
  count: number;
  status: CanvasNodeStatus;
  error: string;
  readOnly: boolean;
  connectionId: string;
  model: string;
  generatedFrom?: string;
}

export interface CanvasNodeDefaults {
  connectionId: string;
  model: string;
}

export interface CanvasEdgeData {
  origin: CanvasEdgeOrigin;
}

export interface CanvasImageAssetSnapshot {
  id: string;
  blob: Blob;
  mime: string;
  name: string;
}

export interface CanvasNodeSnapshotData extends Omit<CanvasNodeData, "references" | "outputs"> {
  references: CanvasImageAssetSnapshot[];
  outputs: CanvasImageAssetSnapshot[];
}

export interface CanvasNodeSnapshot {
  id: string;
  type: CanvasNodeType;
  position: {x: number; y: number};
  data: CanvasNodeSnapshotData;
}

export interface CanvasEdgeSnapshot {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  origin: CanvasEdgeOrigin;
}

export interface CanvasSnapshot {
  version: 1;
  nodes: CanvasNodeSnapshot[];
  edges: CanvasEdgeSnapshot[];
}

export type CanvasNode = FlowNode<CanvasNodeData, any, CanvasNodeType> & {
  type: CanvasNodeType;
  data: CanvasNodeData;
};

export type CanvasEdge = Edge<CanvasEdgeData>;

export class CanvasGraph {
  readonly nodes: ShallowRef<CanvasNode[]> = shallowRef([]);
  readonly edges: ShallowRef<CanvasEdge[]> = shallowRef([]);
  private sequence = 0;

  nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${Date.now()}-${this.sequence}`;
  }

  findNode(id: string): CanvasNode | undefined {
    return this.nodes.value.find((node) => node.id === id);
  }

  add(type: CanvasNodeType, defaults: CanvasNodeDefaults, center?: CanvasPoint): void {
    const index = this.nodes.value.length;
    const width = type === "text" ? 300 : 360;
    const x = center ? center.x - width / 2 : 80 + (index % 3) * 360;
    const y = center ? center.y - 110 : 100 + Math.floor(index / 3) * 330;
    this.nodes.value = [
      ...this.nodes.value,
      this.createNode(type, x, y, defaults),
    ];
  }

  updateData(id: string, patch: Partial<CanvasNodeData>): void {
    this.nodes.value = this.nodes.value.map((node) =>
        node.id === id ? {...node, data: {...node.data, ...patch}} : node
    );
  }

  connect(connection: Connection): void {
    if (!connection.source || !connection.target || connection.source === connection.target) return;
    if (this.edges.value.some(
        (edge) => edge.source === connection.source && edge.target === connection.target
    )) return;
    this.edges.value = addEdge(
        this.createEdge(this.nextId("edge"), connection.source, connection.target, "manual", {
          sourceHandle: connection.sourceHandle,
          targetHandle: connection.targetHandle,
        }),
        [...this.edges.value]
    ) as CanvasEdge[];
  }

  replaceNodes(nodes: FlowNode[]): void {
    this.nodes.value = nodes as CanvasNode[];
  }

  replaceEdges(edges: Edge[]): void {
    this.edges.value = edges as CanvasEdge[];
  }

  removeManualEdge(id: string): boolean {
    const edge = this.edges.value.find((item) => item.id === id);
    if (!edge || edge.data?.origin !== "manual") return false;
    this.edges.value = this.edges.value.filter((item) => item.id !== id);
    return true;
  }

  deleteNode(id: string): string[] {
    const removedIds = new Set([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const node of this.nodes.value) {
        if (node.data.generatedFrom && removedIds.has(node.data.generatedFrom) && !removedIds.has(node.id)) {
          removedIds.add(node.id);
          changed = true;
        }
      }
    }
    const removed = this.nodes.value.filter((node) => removedIds.has(node.id));
    for (const node of removed) this.revokeNodeAssets(node);
    this.nodes.value = this.nodes.value.filter((node) => !removedIds.has(node.id));
    this.edges.value = this.edges.value.filter(
        (edge) => !removedIds.has(edge.source) && !removedIds.has(edge.target)
    );
    return [...removedIds];
  }

  removeGeneratedChildren(parentId: string): void {
    const childIds = new Set(
        this.nodes.value.filter((node) => node.data.generatedFrom === parentId).map((node) => node.id)
    );
    for (const node of this.nodes.value) {
      if (childIds.has(node.id)) this.revokeNodeAssets(node);
    }
    this.nodes.value = this.nodes.value.filter((node) => !childIds.has(node.id));
    this.edges.value = this.edges.value.filter(
        (edge) => !childIds.has(edge.source) && !childIds.has(edge.target)
    );
  }

  directParentNodes(nodeId: string): CanvasNode[] {
    const parentIds = this.edges.value.filter((edge) => edge.target === nodeId).map((edge) => edge.source);
    return parentIds
        .map((parentId) => this.findNode(parentId))
        .filter((node): node is CanvasNode => Boolean(node));
  }

  prompt(node: CanvasNode): string {
    const parts = [node.type === "text" ? node.data.text : node.data.prompt];
    for (const parent of this.directParentNodes(node.id)) {
      if (parent.type !== "text") continue;
      const text = parent.data.outputText.trim() || parent.data.text.trim();
      if (text) parts.push(text);
    }
    return parts.map((part) => part.trim()).filter(Boolean).join("\n\n");
  }

  referenceAssets(node: CanvasNode): CanvasImageAsset[] {
    const assets = [...(node.type === "image" ? node.data.references : [])];
    for (const parent of this.directParentNodes(node.id)) {
      if (parent.type !== "image") continue;
      assets.push(...(parent.data.outputs.length > 0 ? parent.data.outputs : parent.data.references));
    }
    const seen = new Set<string>();
    return assets.filter((asset) => {
      if (seen.has(asset.id)) return false;
      seen.add(asset.id);
      return true;
    });
  }

  addFiles(nodeId: string, files: File[]): void {
    const node = this.findNode(nodeId);
    if (!node || node.type !== "image") return;
    const file = files.find((item) => item.type.startsWith("image/"));
    if (!file) return;
    for (const reference of node.data.references) URL.revokeObjectURL(reference.url);
    this.updateData(nodeId, {
      references: [{
        id: this.nextId("asset"),
        blob: file,
        mime: normalizeMime(file.type),
        url: URL.createObjectURL(file),
        name: file.name,
      }],
    });
  }

  removeReference(nodeId: string, assetId: string): void {
    const node = this.findNode(nodeId);
    if (!node) return;
    const asset = node.data.references.find((item) => item.id === assetId);
    if (asset) URL.revokeObjectURL(asset.url);
    this.updateData(nodeId, {
      references: node.data.references.filter((item) => item.id !== assetId),
    });
  }

  addGeneratedOutputs(parentId: string, blobs: Blob[], prompt: string): void {
    this.removeGeneratedChildren(parentId);
    const source = this.findNode(parentId);
    if (!source) return;
    const outputNodes = blobs.map((blob, index) => {
      const mime = normalizeMime(blob.type);
      const asset: CanvasImageAsset = {
        id: this.nextId("asset"),
        blob,
        mime,
        url: URL.createObjectURL(blob),
        name: `canvas-${Date.now()}-${index + 1}.${extensionForMime(mime)}`,
      };
      return this.createNode("image", source.position.x + 390, source.position.y + index * 250, {
        title: `生成图片 ${index + 1}`,
        references: [asset],
        readOnly: true,
        connectionId: source.data.connectionId,
        model: source.data.model,
        prompt,
        generatedFrom: parentId,
      });
    });
    this.nodes.value = [...this.nodes.value, ...outputNodes];
    this.edges.value = [
      ...this.edges.value,
      ...outputNodes.map((output) => this.createEdge(
          this.nextId("edge"),
          parentId,
          output.id,
          "automatic"
      )),
    ];
  }

  addGeneratedTextChild(parentId: string, text: string): void {
    const source = this.findNode(parentId);
    if (!source) return;
    const siblingCount = this.nodes.value.filter(
        (node) => node.type === "text" && node.data.generatedFrom === parentId
    ).length;
    const output = this.createNode(
        "text",
        source.position.x + 370,
        source.position.y + siblingCount * 240,
        {
          title: "生成文字",
          text,
          connectionId: source.data.connectionId,
          model: source.data.model,
          generatedFrom: parentId,
        }
    );
    this.nodes.value = [...this.nodes.value, output];
    this.edges.value = [
      ...this.edges.value,
      this.createEdge(this.nextId("edge"), parentId, output.id, "automatic"),
    ];
  }

  snapshot(): CanvasSnapshot {
    return {
      version: 1,
      nodes: this.nodes.value.map((node) => ({
        id: node.id,
        type: node.type,
        position: {x: node.position.x, y: node.position.y},
        data: {
          ...node.data,
          status: node.data.status === "running" ? "idle" : node.data.status,
          references: node.data.references.map(snapshotAsset),
          outputs: node.data.outputs.map(snapshotAsset),
        },
      })),
      edges: this.edges.value.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
        origin: edge.data?.origin === "automatic" ? "automatic" : "manual",
      })),
    };
  }

  load(snapshot: CanvasSnapshot): void {
    this.clear();
    this.nodes.value = snapshot.nodes.map((storedNode) => {
      const node = this.createNode(
          storedNode.type,
          storedNode.position.x,
          storedNode.position.y,
          {
            ...storedNode.data,
            status: storedNode.data.status === "running" ? "idle" : storedNode.data.status,
            references: storedNode.data.references.map(restoreAsset),
            outputs: storedNode.data.outputs.map(restoreAsset),
          }
      );
      node.id = storedNode.id;
      return node;
    });
    this.edges.value = snapshot.edges.map((edge) => this.createEdge(
        edge.id,
        edge.source,
        edge.target,
        edge.origin,
        {sourceHandle: edge.sourceHandle, targetHandle: edge.targetHandle}
    ));
  }

  clear(): void {
    for (const node of this.nodes.value) this.revokeNodeAssets(node);
    this.nodes.value = [];
    this.edges.value = [];
  }

  dispose(): void {
    this.clear();
  }

  private createNode(
      type: CanvasNodeType,
      x: number,
      y: number,
      overrides: Partial<CanvasNodeData> = {}
  ): CanvasNode {
    return {
      id: this.nextId(type),
      type,
      position: {x, y},
      width: type === "text" ? 300 : 360,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      draggable: true,
      selectable: true,
      connectable: true,
      deletable: false,
      data: {
        title: type === "text" ? "文字节点" : "图像节点",
        text: "",
        outputText: "",
        prompt: "",
        references: [],
        outputs: [],
        size: "auto",
        customWidth: 1024,
        customHeight: 1024,
        count: 1,
        status: "idle",
        error: "",
        readOnly: false,
        connectionId: "",
        model: "",
        ...overrides,
      },
    };
  }

  private revokeNodeAssets(node: CanvasNode): void {
    const urls = new Set<string>();
    for (const asset of [...node.data.references, ...node.data.outputs]) {
      if (urls.has(asset.url)) continue;
      urls.add(asset.url);
      URL.revokeObjectURL(asset.url);
    }
  }

  private createEdge(
      id: string,
      source: string,
      target: string,
      origin: CanvasEdgeOrigin,
      handles: Pick<CanvasEdge, "sourceHandle" | "targetHandle"> = {}
  ): CanvasEdge {
    return {
      id,
      source,
      target,
      ...handles,
      animated: origin === "automatic",
      interactionWidth: 24,
      class: `canvas-edge-${origin}`,
      data: {origin},
    };
  }
}

function snapshotAsset(asset: CanvasImageAsset): CanvasImageAssetSnapshot {
  return {
    id: asset.id,
    blob: asset.blob,
    mime: asset.mime,
    name: asset.name,
  };
}

function restoreAsset(asset: CanvasImageAssetSnapshot): CanvasImageAsset {
  return {
    ...asset,
    url: URL.createObjectURL(asset.blob),
  };
}

function normalizeMime(mime: string | null | undefined): string {
  const normalized = mime?.split(";", 1)[0].trim().toLowerCase() ?? "";
  return normalized.startsWith("image/") ? normalized : "image/png";
}

function extensionForMime(mime: string): string {
  if (mime.includes("gif")) return "gif";
  if (mime.includes("jpeg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  return "png";
}
