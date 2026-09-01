export type RpcId = string | number;

export type RpcRequest = {
  jsonrpc: '2.0';
  id?: RpcId;
  method: string;
  params?: unknown;
};

export type RpcSuccess = {
  jsonrpc: '2.0';
  id: RpcId | null;
  result: unknown;
};

export type RpcFailure = {
  jsonrpc: '2.0';
  id: RpcId | null;
  error: {
    code: number;
    message: string;
    data?: { errorCode?: string };
  };
};

export type AgentChoice = {
  id: string;
  label: string;
};

export type AgentAskEvent = {
  type: 'ask';
  prompt: string;
  choices?: AgentChoice[];
  allowOther?: boolean;
  field: string;
};

export type AgentConfirmEvent = {
  type: 'confirm';
  actionId: string;
  hash: string;
  title: string;
  summary: string;
  details: Record<string, string>;
};

export type AgentReceiptEvent = {
  type: 'receipt';
  persona?: string;
  written?: string[];
  message: string;
};

export type AgentTextEvent = {
  type: 'text';
  text: string;
};

export type AgentEvent =
  | AgentTextEvent
  | AgentAskEvent
  | AgentConfirmEvent
  | AgentReceiptEvent;

export type AgentChatParams = {
  sessionId?: string;
  message: string;
  locale?: 'ko' | 'en';
  projectPath?: string;
  personaId?: string;
};

export type AgentChatResult = {
  sessionId: string;
  events: AgentEvent[];
};
