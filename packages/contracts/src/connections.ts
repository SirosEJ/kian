export type Destination = { id:string; name:string; canWrite:boolean };
export type ExecutionResult = { status:'succeeded'|'failed'|'uncertain'; externalId?:string; link?:string; error?:string };
export interface Connector<Connection,Command> {
  connect(input:unknown): Promise<Connection>;
  test(connection:Connection): Promise<boolean>;
  listDestinations(connection:Connection): Promise<Destination[]>;
  validate(command:Command): void;
  execute(connection:Connection,command:Command,idempotencyKey:string): Promise<ExecutionResult>;
  disconnect(connection:Connection): Promise<void>;
}
