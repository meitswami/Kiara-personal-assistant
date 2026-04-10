/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import axios from 'axios';

export interface ERPTask {
  id?: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  status: 'pending' | 'in-progress' | 'completed';
  assignedTo?: string;
  projectId?: string;
}

export interface ERPProject {
  id: string;
  name: string;
  description: string;
  status: string;
  team: string[];
}

export interface ERPTeamMember {
  id: string;
  name: string;
  role: string;
  email: string;
  skills: string[];
}

class ERPService {
  private baseUrl: string;
  private apiKey: string;
  private apiSecret: string;
  private token: string;

  constructor() {
    this.baseUrl = import.meta.env.VITE_ERP_API_URL || '';
    this.apiKey = import.meta.env.VITE_ERP_API_KEY || '';
    this.apiSecret = import.meta.env.VITE_ERP_API_SECRET || '';
    this.token = import.meta.env.VITE_ERP_AUTH_TOKEN || '';
  }

  private get headers() {
    return {
      'Authorization': `Bearer ${this.token}`,
      'X-API-Key': this.apiKey,
      'X-API-Secret': this.apiSecret,
      'Content-Type': 'application/json'
    };
  }

  async createTask(task: ERPTask): Promise<ERPTask> {
    try {
      // For demo purposes, we'll simulate the API call if no URL is provided
      if (!this.baseUrl) {
        console.log("Simulating ERP Task Creation:", task);
        return { ...task, id: Math.random().toString(36).substr(2, 9) };
      }
      const response = await axios.post(`${this.baseUrl}/tasks/create`, task, { headers: this.headers });
      return response.data;
    } catch (error) {
      console.error("ERP Create Task Error:", error);
      throw error;
    }
  }

  async getTeam(): Promise<ERPTeamMember[]> {
    try {
      if (!this.baseUrl) {
        return [
          { id: '1', name: 'Jaideep Singh', role: 'Cybersecurity Analyst', email: 'jaideep@example.com', skills: ['Red Teaming', 'VAPT'] },
          { id: '2', name: 'Meit Swami', role: 'Admin / Lead Engineer', email: 'meit2swami@gmail.com', skills: ['System Design', 'AI Architecture'] }
        ];
      }
      const response = await axios.get(`${this.baseUrl}/team`, { headers: this.headers });
      return response.data;
    } catch (error) {
      console.error("ERP Get Team Error:", error);
      throw error;
    }
  }

  async updateProject(projectId: string, updates: Partial<ERPProject>): Promise<ERPProject> {
    try {
      if (!this.baseUrl) {
        console.log(`Simulating ERP Project Update for ${projectId}:`, updates);
        return { id: projectId, name: 'Project X', description: 'Updated', status: 'active', team: [], ...updates };
      }
      const response = await axios.post(`${this.baseUrl}/projects/update`, { projectId, ...updates }, { headers: this.headers });
      return response.data;
    } catch (error) {
      console.error("ERP Update Project Error:", error);
      throw error;
    }
  }
}

export const erpService = new ERPService();
