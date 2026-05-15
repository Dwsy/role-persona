/**
 * Type declarations for Pi SDK modules and other external dependencies.
 * These are peer dependencies that may not be installed locally.
 * Using minimal type declarations to avoid conflicts with actual implementations.
 */

declare module "@mariozechner/pi-ai" {
  export type Model<T = any> = any;
  export type Api = any;
  export type AssistantMessage = any;
  export function StringEnum<T extends readonly string[]>(values: T): any;
}

declare module "@mariozechner/pi-coding-agent" {
  export interface ExtensionAPI {
    registerTool(...args: any[]): any;
    registerContextProvider(...args: any[]): any;
    registerCommand(...args: any[]): any;
    registerMessageRenderer(...args: any[]): any;
    sendMessage(...args: any[]): any;
    on(...args: any[]): any;
    [key: string]: any;
  }
  export type ExtensionContext = any;
  export function convertToLlm<T = any>(...args: any[]): T;
  export function serializeConversation<T = any>(...args: any[]): T;
  export function getLanguageFromPath(...args: any[]): any;
  export function getMarkdownTheme(...args: any[]): any;
  export function highlightCode(...args: any[]): any;
}

declare module "@sinclair/typebox" {
  export const Type: any;
}

declare module "@mariozechner/pi-tui" {
  export class Box {
    constructor(...args: any[]);
    addChild(...args: any[]): any;
    [key: string]: any;
  }
  export class Markdown {
    constructor(...args: any[]);
    [key: string]: any;
  }
  export class Spacer {
    constructor(...args: any[]);
    [key: string]: any;
  }
  export class Text {
    constructor(...args: any[]);
    setText(...args: any[]): any;
    [key: string]: any;
  }
  export class SelectList {
    constructor(...args: any[]);
    onSelect: any;
    onCancel: any;
    handleInput: any;
    [key: string]: any;
  }
  export class Container {
    constructor(...args: any[]);
    addChild(...args: any[]): any;
    render(...args: any[]): any;
    invalidate(): any;
    [key: string]: any;
  }
  export const RoleMemoryViewerComponent: any;
  export function createComponent(...args: any[]): any;
  export function render(component: any, ...args: any[]): any;
}

declare module "@lancedb/lancedb" {
  export function connect(...args: any[]): any;
  export const Connection: any;
  export const Table: any;
  export const Query: any;
}
