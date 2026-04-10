/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Users, Shield, Share2, Search, X, CheckCircle, Key, Copy, RefreshCw, Trash2, UserPlus, Edit2 } from 'lucide-react';
import { db } from '../lib/firebase';
import { collection, getDocs, doc, setDoc, serverTimestamp, query, where, deleteDoc, updateDoc } from 'firebase/firestore';
import CryptoJS from 'crypto-js';

interface UserProfile {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  whatsapp: string;
}

interface ApiKey {
  id: string;
  name: string;
  key: string;
  secret: string;
  createdAt: any;
}

export const AdminPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [activeTab, setActiveTab] = useState<'users' | 'api'>('users');
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [newKeyName, setNewKeyName] = useState('');
  const [sharingResource, setSharingResource] = useState<{ id: string, type: string } | null>(null);
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUser, setNewUser] = useState({ firstName: '', lastName: '', email: '', role: 'user' });

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const userId = doc(collection(db, 'users')).id;
      await setDoc(doc(db, 'users', userId), {
        ...newUser,
        createdAt: serverTimestamp()
      });
      setUsers(prev => [...prev, { id: userId, ...newUser } as UserProfile]);
      setShowAddUser(false);
      setNewUser({ firstName: '', lastName: '', email: '', role: 'user' });
    } catch (error) {
      console.error("Error adding user:", error);
    }
  };

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        if (activeTab === 'users') {
          const querySnapshot = await getDocs(collection(db, 'users'));
          const usersList: UserProfile[] = [];
          querySnapshot.forEach((doc) => {
            usersList.push({ id: doc.id, ...doc.data() } as UserProfile);
          });
          setUsers(usersList);
        } else {
          const querySnapshot = await getDocs(collection(db, 'api_keys'));
          const keysList: ApiKey[] = [];
          querySnapshot.forEach((doc) => {
            keysList.push({ id: doc.id, ...doc.data() } as ApiKey);
          });
          setApiKeys(keysList);
        }
      } catch (error) {
        console.error("Error fetching data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [activeTab]);

  const generateApiKey = async () => {
    if (!newKeyName.trim()) return;
    
    const key = `kiara_${CryptoJS.lib.WordArray.random(16).toString()}`;
    const secret = CryptoJS.lib.WordArray.random(32).toString();
    
    try {
      const keyId = doc(collection(db, 'api_keys')).id;
      await setDoc(doc(db, 'api_keys', keyId), {
        name: newKeyName,
        key,
        secret,
        createdAt: serverTimestamp()
      });
      setApiKeys(prev => [...prev, { id: keyId, name: newKeyName, key, secret, createdAt: new Date() }]);
      setNewKeyName('');
    } catch (error) {
      console.error("Error generating API key:", error);
    }
  };

  const deleteApiKey = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'api_keys', id));
      setApiKeys(prev => prev.filter(k => k.id !== id));
    } catch (error) {
      console.error("Error deleting API key:", error);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!window.confirm("Are you sure you want to remove this user? This action cannot be undone.")) return;
    
    try {
      await deleteDoc(doc(db, 'users', userId));
      setUsers(prev => prev.filter(u => u.id !== userId));
    } catch (error) {
      console.error("Error deleting user:", error);
      alert("Failed to delete user. You might not have permission.");
    }
  };

  const toggleUserRole = async (user: UserProfile) => {
    const newRole = user.role === 'admin' ? 'user' : 'admin';
    try {
      await updateDoc(doc(db, 'users', user.id), { role: newRole });
      setUsers(prev => prev.map(u => u.id === user.id ? { ...u, role: newRole } : u));
    } catch (error) {
      console.error("Error updating role:", error);
    }
  };

  const handleShare = async (targetUserId: string) => {
    if (!sharingResource) return;

    try {
      const shareId = `${targetUserId}_${sharingResource.id}`;
      await setDoc(doc(db, 'shared', shareId), {
        resourceId: sharingResource.id,
        resourceType: sharingResource.type,
        sharedWith: targetUserId,
        sharedBy: 'admin',
        createdAt: serverTimestamp()
      });
      alert("Shared successfully!");
      setSharingResource(null);
    } catch (error) {
      console.error("Error sharing resource:", error);
    }
  };

  const filteredUsers = users.filter(u => 
    u.firstName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.lastName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4"
    >
      <div className="w-full max-w-4xl bg-[#111] border border-white/10 rounded-3xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-6 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-blue-500/20">
              <Shield className="w-6 h-6 text-blue-500" />
            </div>
            <div>
              <h2 className="text-xl font-bold">Admin Command Center</h2>
              <p className="text-xs text-gray-500">Manage users and resource access</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-white/10 px-6">
          <button 
            onClick={() => setActiveTab('users')}
            className={`py-4 px-6 text-sm font-medium transition-colors relative ${
              activeTab === 'users' ? 'text-blue-500' : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            Users
            {activeTab === 'users' && <motion.div layoutId="tab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500" />}
          </button>
          <button 
            onClick={() => setActiveTab('api')}
            className={`py-4 px-6 text-sm font-medium transition-colors relative ${
              activeTab === 'api' ? 'text-blue-500' : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            Developer API
            {activeTab === 'api' && <motion.div layoutId="tab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500" />}
          </button>
        </div>

        {/* Search / API Key Generator */}
        <div className="p-6 border-b border-white/10">
          {activeTab === 'users' ? (
            <div className="flex gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-3 w-5 h-5 text-gray-500" />
                <input
                  type="text"
                  placeholder="Search users by name or email..."
                  className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-12 pr-4 text-sm focus:outline-none focus:border-blue-500/50 transition-colors"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <button 
                onClick={() => setShowAddUser(true)}
                className="px-4 py-3 bg-blue-500/20 text-blue-400 rounded-xl text-sm font-bold hover:bg-blue-500/30 transition-colors flex items-center gap-2"
              >
                <UserPlus className="w-4 h-4" />
                Add User
              </button>
            </div>
          ) : (
            <div className="flex gap-3">
              <input
                type="text"
                placeholder="Key Name (e.g., ERP Integration)"
                className="flex-1 bg-white/5 border border-white/10 rounded-xl py-3 px-4 text-sm focus:outline-none focus:border-blue-500/50 transition-colors"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
              />
              <button 
                onClick={generateApiKey}
                className="px-6 py-3 bg-blue-500 text-white rounded-xl text-sm font-bold hover:bg-blue-600 transition-colors flex items-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                Generate Key
              </button>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center h-40">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-blue-500" />
            </div>
          ) : activeTab === 'users' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredUsers.map(user => (
                <div 
                  key={user.id}
                  className="p-4 rounded-2xl bg-white/5 border border-white/5 hover:border-white/20 transition-all group"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500/20 to-pink-500/20 flex items-center justify-center text-sm font-bold">
                        {user.firstName[0]}{user.lastName[0]}
                      </div>
                      <div>
                        <h3 className="font-medium">{user.firstName} {user.lastName}</h3>
                        <p className="text-xs text-gray-500">{user.email}</p>
                      </div>
                    </div>
                    <div className={`px-2 py-1 rounded-md text-[10px] uppercase font-bold ${
                      user.role === 'admin' ? 'bg-blue-500/20 text-blue-400' : 'bg-gray-500/20 text-gray-400'
                    }`}>
                      {user.role}
                    </div>
                  </div>
                  
                  <div className="mt-4 flex items-center gap-2">
                    <button 
                      onClick={() => handleShare(user.id)}
                      className="flex-1 py-2 rounded-lg bg-white/5 hover:bg-blue-500/20 text-xs font-medium transition-colors flex items-center justify-center gap-2"
                    >
                      <Share2 className="w-3.5 h-3.5" />
                      Grant Access
                    </button>
                    <button 
                      onClick={() => toggleUserRole(user)}
                      className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
                      title="Toggle Admin Role"
                    >
                      <Shield className={`w-4 h-4 ${user.role === 'admin' ? 'text-blue-500' : 'text-gray-500'}`} />
                    </button>
                    <button 
                      onClick={() => handleDeleteUser(user.id)}
                      className="p-2 rounded-lg bg-white/5 hover:bg-red-500/20 transition-colors group/delete"
                      title="Remove User"
                    >
                      <Trash2 className="w-4 h-4 text-gray-500 group-hover/delete:text-red-500" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {apiKeys.length > 0 ? apiKeys.map(key => (
                <div key={key.id} className="p-6 rounded-2xl bg-white/5 border border-white/5">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-blue-500/10">
                        <Key className="w-5 h-5 text-blue-500" />
                      </div>
                      <h3 className="font-bold">{key.name}</h3>
                    </div>
                    <button 
                      onClick={() => deleteApiKey(key.id)}
                      className="text-xs text-red-500 hover:text-red-400 font-medium"
                    >
                      Revoke
                    </button>
                  </div>
                  
                  <div className="space-y-3">
                    <div>
                      <label className="text-[10px] uppercase tracking-widest text-gray-500 mb-1 block">API Key</label>
                      <div className="flex items-center gap-2 bg-black/40 p-2 rounded-lg border border-white/5">
                        <code className="text-xs text-blue-400 flex-1 truncate">{key.key}</code>
                        <button 
                          onClick={() => navigator.clipboard.writeText(key.key)}
                          className="p-1.5 hover:bg-white/5 rounded-md transition-colors"
                        >
                          <Copy className="w-3.5 h-3.5 text-gray-400" />
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] uppercase tracking-widest text-gray-500 mb-1 block">API Secret</label>
                      <div className="flex items-center gap-2 bg-black/40 p-2 rounded-lg border border-white/5">
                        <code className="text-xs text-pink-400 flex-1 truncate">{key.secret}</code>
                        <button 
                          onClick={() => navigator.clipboard.writeText(key.secret)}
                          className="p-1.5 hover:bg-white/5 rounded-md transition-colors"
                        >
                          <Copy className="w-3.5 h-3.5 text-gray-400" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )) : (
                <div className="text-center py-12">
                  <Key className="w-12 h-12 text-gray-700 mx-auto mb-4" />
                  <p className="text-sm text-gray-500">No API keys generated yet.</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-white/10 bg-white/[0.02] flex items-center justify-between">
          <p className="text-xs text-gray-500">Total Users: {users.length}</p>
          <div className="flex items-center gap-2 text-xs text-green-500">
            <CheckCircle className="w-4 h-4" />
            <span>All systems operational</span>
          </div>
        </div>
      </div>

      {/* Add User Modal */}
      <AnimatePresence>
        {showAddUser && (
          <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-md bg-[#111] border border-white/10 rounded-3xl overflow-hidden"
            >
              <div className="p-6 border-b border-white/10 flex items-center justify-between">
                <h2 className="text-xl font-bold">Add New User</h2>
                <button onClick={() => setShowAddUser(false)} className="p-2 hover:bg-white/5 rounded-full">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <form onSubmit={handleAddUser} className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] uppercase tracking-widest text-gray-500 mb-1 block">First Name</label>
                    <input
                      required
                      type="text"
                      className="w-full bg-white/5 border border-white/10 rounded-xl py-2 px-4 text-sm focus:outline-none focus:border-blue-500/50"
                      value={newUser.firstName}
                      onChange={(e) => setNewUser({ ...newUser, firstName: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-widest text-gray-500 mb-1 block">Last Name</label>
                    <input
                      required
                      type="text"
                      className="w-full bg-white/5 border border-white/10 rounded-xl py-2 px-4 text-sm focus:outline-none focus:border-blue-500/50"
                      value={newUser.lastName}
                      onChange={(e) => setNewUser({ ...newUser, lastName: e.target.value })}
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-widest text-gray-500 mb-1 block">Email Address</label>
                  <input
                    required
                    type="email"
                    className="w-full bg-white/5 border border-white/10 rounded-xl py-2 px-4 text-sm focus:outline-none focus:border-blue-500/50"
                    value={newUser.email}
                    onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-widest text-gray-500 mb-1 block">Role</label>
                  <select
                    className="w-full bg-white/5 border border-white/10 rounded-xl py-2 px-4 text-sm focus:outline-none focus:border-blue-500/50"
                    value={newUser.role}
                    onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <button 
                  type="submit"
                  className="w-full py-3 bg-blue-500 text-white rounded-xl font-bold hover:bg-blue-600 transition-colors mt-4"
                >
                  Create User
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
