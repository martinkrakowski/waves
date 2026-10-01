export interface StorePort<TProject, TSnapshot> {
  getProject(id: string): Promise<TProject | undefined>;
  listProjects(): Promise<readonly TProject[]>;
  putProject(project: TProject): Promise<void>;
  deleteProject(id: string): Promise<void>;
  putSnapshot(snapshot: TSnapshot): Promise<void>;
  getSnapshot(project: string, wave: string): Promise<TSnapshot | undefined>;
  listSnapshots(project: string): Promise<readonly TSnapshot[]>;
  deleteSnapshot(project: string, wave: string): Promise<void>;
}
