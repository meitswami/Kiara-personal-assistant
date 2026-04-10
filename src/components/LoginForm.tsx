/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { motion } from 'motion/react';
import { LogIn, Mail, Lock, ArrowRight } from 'lucide-react';
import { signInWithEmailAndPassword, auth } from '../lib/firebase';

interface LoginFormProps {
  onSuccess: () => void;
  onSwitchToRegister: () => void;
}

export const LoginForm: React.FC<LoginFormProps> = ({ onSuccess, onSwitchToRegister }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      onSuccess();
    } catch (err: any) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-md bg-white/5 backdrop-blur-xl border border-white/10 p-8 rounded-3xl shadow-2xl"
    >
      <div className="text-center mb-8">
        <div className="inline-flex p-3 rounded-2xl bg-blue-500/20 mb-4">
          <LogIn className="w-6 h-6 text-blue-500" />
        </div>
        <h2 className="text-2xl font-bold tracking-tight">Welcome Back</h2>
        <p className="text-gray-400 text-sm mt-2">Sign in to access Kiara</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="relative">
          <Mail className="absolute left-3 top-3 w-4 h-4 text-gray-500" />
          <input
            type="email"
            placeholder="Email Address"
            required
            className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 pl-10 pr-4 text-sm focus:outline-none focus:border-blue-500/50 transition-colors"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="relative">
          <Lock className="absolute left-3 top-3 w-4 h-4 text-gray-500" />
          <input
            type="password"
            placeholder="Password"
            required
            className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 pl-10 pr-4 text-sm focus:outline-none focus:border-blue-500/50 transition-colors"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {error && <p className="text-red-500 text-xs text-center">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2 group"
        >
          {loading ? "Signing In..." : "Sign In"}
          <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
        </button>
      </form>

      <p className="text-center text-gray-500 text-xs mt-6">
        Don't have an account?{" "}
        <button onClick={onSwitchToRegister} className="text-pink-500 hover:underline">
          Register Now
        </button>
      </p>
    </motion.div>
  );
};
