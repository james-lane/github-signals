import { engineerId, repositoryName } from '../domain/configuration.js';
import { saveConfig } from '../infrastructure/config/config-store.js';
import type { DashboardState } from './dashboard-state.js';

export interface ConfigurationTarget extends DashboardState {
  prompt(question: string, initial?: string): Promise<string>;
  render(): void;
  success(message: string): string;
  warning(message: string): string;
  error(message: string): string;
}

export class ConfigurationActions {
  public constructor(private readonly target: ConfigurationTarget) {}

  public async add(): Promise<void> {
    const type = await this.target.prompt(
      'Add (e)ngineer or (r)epository',
      this.target.currentView() === 'Repositories' ? 'r' : 'e',
    );
    if (type.toLowerCase().startsWith('r')) await this.addRepository();
    else await this.addEngineer();
    await saveConfig(this.target.config);
    this.target.render();
  }

  public async remove(): Promise<void> {
    if (this.target.currentView() === 'Repositories') await this.removeRepository();
    else await this.removeEngineer();
    this.target.render();
  }

  public async prioritizeRepository(): Promise<void> {
    const target = this.target;
    if (target.currentView() !== 'Repositories' || !target.config.repositories.length) {
      target.message = target.warning('Open Repositories to change a priority.');
      target.render();
      return;
    }
    const choices = target.config.repositories.map(repositoryName);
    const name = await target.prompt(`Toggle owned/contributing (${choices.join(', ')})`);
    const repository = target.config.repositories.find(item => repositoryName(item) === name);
    if (!repository) target.message = target.warning('No exact repository match found.');
    else {
      repository.priority = repository.priority === 'owned' ? 'contributing' : 'owned';
      await saveConfig(target.config);
      target.message = target.success(`${name} is now ${repository.priority}.`);
    }
    target.render();
  }

  private async addRepository(): Promise<void> {
    const target = this.target;
    const name = await target.prompt('Repository (owner/name)');
    const priorityInput = await target.prompt('Priority: (o)wned or (c)ontributing', 'c');
    const priority = priorityInput.toLowerCase().startsWith('o') ? 'owned' : 'contributing';
    const isValid = /^[^/\s]+\/[^/\s]+$/.test(name);
    const isDuplicate = target.config.repositories.some(repository => repositoryName(repository) === name);
    if (isValid && !isDuplicate) target.config.repositories.push({ name, priority });
    else if (name) target.message = target.error('Use owner/repository format, or remove the duplicate.');
  }

  private async addEngineer(): Promise<void> {
    const target = this.target;
    const id = (await target.prompt('GitHub login (without @)')).replace(/^@/, '');
    const name = await target.prompt('Actual name', id);
    const isValid = /^[\w-]+$/.test(id);
    const isDuplicate = target.config.engineers.some(engineer => engineerId(engineer) === id);
    if (isValid && !isDuplicate) target.config.engineers.push({ id, name });
    else if (id) target.message = target.error('That login is invalid or already configured.');
  }

  private async removeRepository(): Promise<void> {
    const target = this.target;
    const choices = target.config.repositories.map(repositoryName);
    if (!choices.length) {
      target.message = target.warning('Nothing to remove on this screen.');
      return;
    }
    const name = await target.prompt(`Remove (${choices.join(', ')})`);
    const index = choices.indexOf(name);
    if (index >= 0) {
      target.config.repositories.splice(index, 1);
      await saveConfig(target.config);
    } else target.message = target.warning('No exact match found.');
  }

  private async removeEngineer(): Promise<void> {
    const target = this.target;
    const choices = target.config.engineers.map(engineerId);
    if (!choices.length) {
      target.message = target.warning('Nothing to remove on this screen.');
      return;
    }
    const name = (await target.prompt(`Remove (${choices.join(', ')})`)).replace(/^@/, '');
    const index = choices.indexOf(name);
    if (index >= 0) {
      target.config.engineers.splice(index, 1);
      await saveConfig(target.config);
    } else target.message = target.warning('No exact match found.');
  }
}
