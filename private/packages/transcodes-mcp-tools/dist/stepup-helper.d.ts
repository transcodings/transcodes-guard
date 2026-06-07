export declare function execProtectedTool(toolName: string, run: (sid: string | undefined) => Promise<string>): Promise<{
    isError: boolean;
    content: {
        type: 'text';
        text: string;
    }[];
}>;
