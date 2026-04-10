/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AIService } from '../services/ai-service';
import { erpService } from '../services/erp-service';
import { LiveSession } from './live-session';
import { AudioStreamer } from './audio-streamer';

export class AssistantCore {
  public audioEngine: AudioStreamer;
  public aiService: typeof AIService;
  public erpConnector: typeof erpService;
  public liveSession: LiveSession | null = null;

  constructor() {
    this.audioEngine = new AudioStreamer();
    this.aiService = AIService;
    this.erpConnector = erpService;
  }

  async initializeLiveSession(apiKey: string) {
    this.liveSession = new LiveSession(apiKey);
    return this.liveSession;
  }

  async syncWithERP() {
    console.log("Syncing with ERP...");
    const team = await this.erpConnector.getTeam();
    console.log("Team synced:", team);
    return team;
  }

  async processConversation(transcript: string) {
    const analysis = await this.aiService.analyzeConversation(transcript);
    
    // Store in memory
    await this.aiService.storeMemory({
      type: "meeting",
      content: analysis.summary,
      entities: { items: analysis.entities },
      actionItems: analysis.actionItems,
      priority: analysis.opportunityScore > 7 ? "high" : "medium"
    });

    // Auto-create tasks in ERP if high priority
    if (analysis.opportunityScore > 8) {
      for (const item of analysis.actionItems) {
        await this.erpConnector.createTask({
          title: item,
          description: `Generated from conversation: ${analysis.topic}`,
          priority: 'high',
          status: 'pending'
        });
      }
    }

    return analysis;
  }

  async getInsights() {
    const memories = await this.aiService.searchMemory("");
    const ideas = await this.aiService.generateIdeas(memories);
    return ideas;
  }
}

export const assistantCore = new AssistantCore();
