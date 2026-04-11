/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { motion } from 'motion/react';
import { UserPlus, Mail, Lock, Phone, User, ArrowRight } from 'lucide-react';
import { createUserWithEmailAndPassword, auth, db } from '../lib/firebase';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';

interface RegistrationFormProps {
  onSuccess: () => void;
  onSwitchToLogin: () => void;
}

export const RegistrationForm: React.FC<RegistrationFormProps> = ({ onSuccess, onSwitchToLogin }) => {
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    whatsapp: '',
    email: '',
    gender: 'male',
    password: '',
    confirmPassword: ''
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    if (formData.password !== formData.confirmPassword) {
      setError("Passwords don't match");
      return;
    }

    setLoading(true);
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, formData.email, formData.password);
      const user = userCredential.user;

      // Create user profile in Firestore
      const role = formData.email.toLowerCase() === 'meit2swami@gmail.com' ? 'admin' : 'user';
      await setDoc(doc(db, 'users', user.uid), {
        firstName: formData.firstName,
        lastName: formData.lastName,
        whatsapp: formData.whatsapp,
        email: formData.email,
        gender: formData.gender,
        aiPersonality: 'sassy', // Default personality
        role: role,
        createdAt: serverTimestamp()
      });

      onSuccess();
    } catch (err: any) {
      setError(err.message || "Registration failed");
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
        <div className="inline-flex p-3 rounded-2xl bg-pink-500/20 mb-4">
          <UserPlus className="w-6 h-6 text-pink-500" />
        </div>
        <h2 className="text-2xl font-bold tracking-tight">Join Kiara</h2>
        <p className="text-gray-400 text-sm mt-2">Create your personal intelligence profile</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="relative">
            <User className="absolute left-3 top-3 w-4 h-4 text-gray-500" />
            <input
              type="text"
              placeholder="First Name"
              required
              className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 pl-10 pr-4 text-sm focus:outline-none focus:border-pink-500/50 transition-colors"
              value={formData.firstName}
              onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
            />
          </div>
          <div className="relative">
            <input
              type="text"
              placeholder="Last Name"
              required
              className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:border-pink-500/50 transition-colors"
              value={formData.lastName}
              onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
            />
          </div>
        </div>

        <div className="relative">
          <Phone className="absolute left-3 top-3 w-4 h-4 text-gray-500" />
          <input
            type="tel"
            placeholder="WhatsApp Mobile No."
            required
            className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 pl-10 pr-4 text-sm focus:outline-none focus:border-pink-500/50 transition-colors"
            value={formData.whatsapp}
            onChange={(e) => setFormData({ ...formData, whatsapp: e.target.value })}
          />
        </div>

        <div className="relative">
          <Mail className="absolute left-3 top-3 w-4 h-4 text-gray-500" />
          <input
            type="email"
            placeholder="Email Address"
            required
            className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 pl-10 pr-4 text-sm focus:outline-none focus:border-pink-500/50 transition-colors"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
          />
        </div>

        <div className="grid grid-cols-3 gap-2">
          {['male', 'female', 'other'].map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setFormData({ ...formData, gender: g })}
              className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all ${
                formData.gender === g 
                  ? 'bg-pink-500 border-pink-500 text-white' 
                  : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
              }`}
            >
              {g.charAt(0).toUpperCase() + g.slice(1)}
            </button>
          ))}
        </div>

        <div className="relative">
          <Lock className="absolute left-3 top-3 w-4 h-4 text-gray-500" />
          <input
            type="password"
            placeholder="Password"
            required
            className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 pl-10 pr-4 text-sm focus:outline-none focus:border-pink-500/50 transition-colors"
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
          />
        </div>

        <div className="relative">
          <Lock className="absolute left-3 top-3 w-4 h-4 text-gray-500" />
          <input
            type="password"
            placeholder="Confirm Password"
            required
            className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 pl-10 pr-4 text-sm focus:outline-none focus:border-pink-500/50 transition-colors"
            value={formData.confirmPassword}
            onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
          />
        </div>

        {error && <p className="text-red-500 text-xs text-center">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-pink-500 hover:bg-pink-600 text-white font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2 group"
        >
          {loading ? "Creating Account..." : "Register Now"}
          <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
        </button>
      </form>

      <p className="text-center text-gray-500 text-xs mt-6">
        Already have an account?{" "}
        <button onClick={onSwitchToLogin} className="text-pink-500 hover:underline">
          Sign In
        </button>
      </p>
    </motion.div>
  );
};
