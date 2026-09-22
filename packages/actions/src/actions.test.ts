import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { PrincipalContext } from "@skrivebord/contracts";
import { executeAction, InMemoryActionStore } from "./index";
const human:PrincipalContext={principalId:"u_lene",principalType:"HUMAN",workspaceId:"ws_a",roles:["OWNER"],capabilities:["today.manage"],authStrength:"SESSION",source:"WEB",requestId:"req_1"};
const definition={id:"today.complete",input:z.object({workspaceId:z.string(),workItemId:z.string()}).strict(),requiredCapabilities:["today.manage"],risk:()=>"LOW" as const,preview:async()=>"Markér arbejdet som færdigt",execute:async({input}:{input:{workspaceId:string;workItemId:string}})=>({id:input.workItemId,status:"DONE"})};
describe("Action Layer",()=>{it("blocks a cross-workspace command before execution",async()=>{const store=new InMemoryActionStore();const result=await executeAction({definition,principal:human,rawInput:{workspaceId:"ws_b",workItemId:"w_1"},store});expect(result.status).toBe("DENIED");});it("records intent and audit for permitted execution",async()=>{const store=new InMemoryActionStore();const result=await executeAction({definition,principal:human,rawInput:{workspaceId:"ws_a",workItemId:"w_1"},store});expect(result.status).toBe("SUCCEEDED");expect(store.intents).toHaveLength(1);expect(store.audit.at(-1)?.outcome).toBe("SUCCEEDED");});});
