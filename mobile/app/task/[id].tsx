import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  Modal,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { api } from '../../src/services/api';
import { Task, EditProposal } from '../../src/types';

export default function TaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(new Date());
  
  // Note state
  const [noteContent, setNoteContent] = useState('');
  const [noteEditing, setNoteEditing] = useState(false);
  const [noteSaving, setNoteSaving] = useState(false);
  
  // Proposals state
  const [proposals, setProposals] = useState<EditProposal[]>([]);
  const [showProposals, setShowProposals] = useState(false);
  const [showNewProposal, setShowNewProposal] = useState(false);
  const [newProposalDesc, setNewProposalDesc] = useState('');
  const [newProposalReason, setNewProposalReason] = useState('');
  const [proposalSubmitting, setProposalSubmitting] = useState(false);

  useEffect(() => {
    if (id) {
      loadTask(parseInt(id));
    }
  }, [id]);

  // Update countdown every second
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const loadTask = async (taskId: number) => {
    try {
      const data = await api.getTask(taskId);
      setTask(data);
      setNoteContent(data.my_note || '');
    } catch (error) {
      console.error('Failed to load task:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadProposals = async () => {
    if (!task) return;
    try {
      const data = await api.getEditProposals(task.id);
      setProposals(data);
    } catch (error) {
      console.error('Failed to load proposals:', error);
    }
  };

  const handleVote = async (type: 'upvote' | 'downvote') => {
    if (!task) return;
    try {
      await api.voteTask(task.id, type);
      loadTask(task.id);
    } catch (error) {
      console.error('Vote failed:', error);
    }
  };

  const handleSaveNote = async () => {
    if (!task) return;
    setNoteSaving(true);
    try {
      if (noteContent.trim()) {
        await api.saveTaskNote(task.id, noteContent.trim());
      } else {
        await api.deleteTaskNote(task.id);
      }
      setNoteEditing(false);
      loadTask(task.id);
    } catch (error) {
      Alert.alert('保存失败', '无法保存备注');
    } finally {
      setNoteSaving(false);
    }
  };

  const handleOpenProposals = async () => {
    await loadProposals();
    setShowProposals(true);
  };

  const handleSubmitProposal = async () => {
    if (!task || !newProposalDesc.trim()) return;
    setProposalSubmitting(true);
    try {
      await api.createEditProposal(task.id, {
        new_description: newProposalDesc.trim(),
        reason: newProposalReason.trim() || undefined,
      });
      setNewProposalDesc('');
      setNewProposalReason('');
      setShowNewProposal(false);
      Alert.alert('提交成功', '您的修改建议已提交，等待社区审核');
      loadTask(task.id);
      loadProposals();
    } catch (error: any) {
      Alert.alert('提交失败', error.message || '无法提交修改建议');
    } finally {
      setProposalSubmitting(false);
    }
  };

  const handleVoteProposal = async (proposalId: number, type: 'upvote' | 'downvote') => {
    if (!task) return;
    try {
      await api.voteProposal(task.id, proposalId, type);
      loadProposals();
    } catch (error: any) {
      Alert.alert('投票失败', error.message || '无法投票');
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  if (!task) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>任务不存在</Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backLink}>返回</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const dueDate = new Date(task.due_time);
  const isOverdue = dueDate < now;
  const diffMs = dueDate.getTime() - now.getTime();
  const absDiffMs = Math.abs(diffMs);
  const diffDays = Math.floor(absDiffMs / (1000 * 60 * 60 * 24));
  const diffHours = Math.floor((absDiffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const diffMinutes = Math.floor((absDiffMs % (1000 * 60 * 60)) / (1000 * 60));
  const diffSeconds = Math.floor((absDiffMs % (1000 * 60)) / 1000);

  const formatRemaining = () => {
    const prefix = isOverdue ? '已逾期 ' : '剩余 ';
    if (diffDays > 0) {
      return `${prefix}${diffDays}天 ${diffHours}时 ${diffMinutes}分 ${diffSeconds}秒`;
    }
    if (diffHours > 0) {
      return `${prefix}${diffHours}时 ${diffMinutes}分 ${diffSeconds}秒`;
    }
    return `${prefix}${diffMinutes}分 ${diffSeconds}秒`;
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← 返回</Text>
        </TouchableOpacity>
      </View>

      {/* Main Content */}
      <View style={styles.main}>
        <View style={styles.topRow}>
          <View style={styles.courseBadge}>
            <Text style={styles.courseText}>{task.course_name || task.course_abbr}</Text>
          </View>
          {task.status === 'verified' && (
            <Text style={styles.verifiedSmall}>✓ 已验证</Text>
          )}
        </View>

        <Text style={styles.title}>{task.title}</Text>

        <View style={styles.dueRow}>
          <Text style={[styles.dueTime, isOverdue && styles.overdue]}>
            截止：{dueDate.toLocaleDateString('zh-CN', {
              month: 'long',
              day: 'numeric',
              weekday: 'short',
            })}
            {' '}
            {dueDate.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
          </Text>
          <Text style={[styles.remaining, isOverdue && styles.overdue]}>
            {formatRemaining()}
          </Text>
        </View>

        {task.description && (
          <View style={styles.descSection}>
            <View style={styles.descHeader}>
              <Text style={styles.descLabel}>详细说明</Text>
              <TouchableOpacity onPress={handleOpenProposals}>
                <Text style={styles.proposeLink}>
                  {(task.pending_proposals_count || 0) > 0 
                    ? `查看修改建议 (${task.pending_proposals_count})` 
                    : '提议修改'}
                </Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.description}>{task.description}</Text>
          </View>
        )}

        {!task.description && (
          <View style={styles.descSection}>
            <View style={styles.descHeader}>
              <Text style={styles.descLabel}>详细说明</Text>
              {(task.pending_proposals_count || 0) > 0 && (
                <TouchableOpacity onPress={handleOpenProposals}>
                  <Text style={styles.proposeLink}>
                    查看修改建议 ({task.pending_proposals_count})
                  </Text>
                </TouchableOpacity>
              )}
            </View>
            <Text style={styles.noDescText}>暂无说明</Text>
            <TouchableOpacity 
              style={styles.addDescBtn}
              onPress={() => {
                setNewProposalDesc('');
                setNewProposalReason('');
                setShowNewProposal(true);
              }}
            >
              <Text style={styles.proposeLink}>+ 添加说明</Text>
            </TouchableOpacity>
          </View>
        )}

        <Text style={styles.meta}>
          由 {task.creator_nickname || '匿名用户'} 创建
        </Text>
      </View>

      {/* My Note Section */}
      <View style={styles.noteSection}>
        <View style={styles.noteTitleRow}>
          <Text style={styles.noteTitle}>📝 我的备注</Text>
          {!noteEditing && (
            <TouchableOpacity onPress={() => setNoteEditing(true)}>
              <Text style={styles.editLink}>{task.my_note ? '编辑' : '添加'}</Text>
            </TouchableOpacity>
          )}
        </View>
        
        {noteEditing ? (
          <View style={styles.noteEditArea}>
            <TextInput
              style={styles.noteInput}
              value={noteContent}
              onChangeText={setNoteContent}
              placeholder="记录你对这个任务的私人笔记..."
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />
            <View style={styles.noteActions}>
              <TouchableOpacity 
                style={styles.noteCancelBtn}
                onPress={() => {
                  setNoteContent(task.my_note || '');
                  setNoteEditing(false);
                }}
              >
                <Text style={styles.noteCancelText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.noteSaveBtn, noteSaving && styles.btnDisabled]}
                onPress={handleSaveNote}
                disabled={noteSaving}
              >
                <Text style={styles.noteSaveText}>
                  {noteSaving ? '保存中...' : '保存'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <Text style={styles.noteContent}>
            {task.my_note || '暂无备注，点击添加'}
          </Text>
        )}
        <Text style={styles.noteHint}>备注仅自己可见</Text>
      </View>

      {/* Vote Section */}
      <View style={styles.voteSection}>
        <Text style={styles.voteQuestion}>这个信息准确吗？</Text>
        <View style={styles.voteButtons}>
          <TouchableOpacity
            style={[styles.voteBtn, task.my_vote === 'upvote' && styles.votedUp]}
            onPress={() => handleVote('upvote')}
          >
            <Text style={styles.voteEmoji}>👍</Text>
            <Text style={styles.voteCount}>{task.upvotes}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.voteBtn, task.my_vote === 'downvote' && styles.votedDown]}
            onPress={() => handleVote('downvote')}
          >
            <Text style={styles.voteEmoji}>👎</Text>
            <Text style={styles.voteCount}>{task.downvotes}</Text>
          </TouchableOpacity>
        </View>
      </View>
      </ScrollView>

      {/* Proposals Modal */}
      <Modal
        visible={showProposals}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowProposals(false)}
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>修改建议</Text>
            <TouchableOpacity onPress={() => setShowProposals(false)}>
              <Text style={styles.closeText}>关闭</Text>
            </TouchableOpacity>
          </View>
          
          <ScrollView style={styles.modalContent}>
            <TouchableOpacity 
              style={styles.newProposalBtn}
              onPress={() => {
                setNewProposalDesc(task.description || '');
                setShowNewProposal(true);
              }}
            >
              <Text style={styles.newProposalText}>+ 提交新的修改建议</Text>
            </TouchableOpacity>

            {proposals.length === 0 ? (
              <Text style={styles.emptyText}>暂无修改建议</Text>
            ) : (
              proposals.map((proposal) => (
                <View key={proposal.id} style={styles.proposalCard}>
                  <View style={styles.proposalHeader}>
                    <Text style={styles.proposerName}>
                      {proposal.proposer_nickname || '匿名用户'}
                    </Text>
                    <Text style={[
                      styles.proposalStatus,
                      proposal.status === 'approved' && styles.statusApproved,
                      proposal.status === 'rejected' && styles.statusRejected,
                    ]}>
                      {proposal.status === 'pending' ? '待审核' : 
                       proposal.status === 'approved' ? '已采纳' : '已拒绝'}
                    </Text>
                  </View>
                  
                  <Text style={styles.proposalDesc}>{proposal.new_description}</Text>
                  
                  {proposal.reason && (
                    <Text style={styles.proposalReason}>
                      修改原因：{proposal.reason}
                    </Text>
                  )}
                  
                  {proposal.status === 'pending' && (
                    <View style={styles.proposalVotes}>
                      <TouchableOpacity
                        style={[styles.pVoteBtn, proposal.my_vote === 'upvote' && styles.pVotedUp]}
                        onPress={() => handleVoteProposal(proposal.id, 'upvote')}
                      >
                        <Text>👍 {proposal.upvotes}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.pVoteBtn, proposal.my_vote === 'downvote' && styles.pVotedDown]}
                        onPress={() => handleVoteProposal(proposal.id, 'downvote')}
                      >
                        <Text>👎 {proposal.downvotes}</Text>
                      </TouchableOpacity>
                      <Text style={styles.voteHint}>需3票通过</Text>
                    </View>
                  )}
                </View>
              ))
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* New Proposal Modal */}
      <Modal
        visible={showNewProposal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowNewProposal(false)}
      >
        <KeyboardAvoidingView 
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <SafeAreaView style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setShowNewProposal(false)}>
                <Text style={styles.cancelText}>取消</Text>
              </TouchableOpacity>
              <Text style={styles.modalTitle}>提交修改建议</Text>
              <TouchableOpacity 
                onPress={handleSubmitProposal}
                disabled={proposalSubmitting || !newProposalDesc.trim()}
              >
                <Text style={[
                  styles.submitText,
                  (!newProposalDesc.trim() || proposalSubmitting) && styles.submitDisabled
                ]}>
                  {proposalSubmitting ? '提交中...' : '提交'}
                </Text>
              </TouchableOpacity>
            </View>
            
            <ScrollView style={styles.modalContent}>
              <Text style={styles.inputLabel}>新的详细说明</Text>
              <TextInput
                style={styles.proposalInput}
                value={newProposalDesc}
                onChangeText={setNewProposalDesc}
                placeholder="输入修改后的内容..."
                multiline
                numberOfLines={8}
                textAlignVertical="top"
              />
              
              <Text style={styles.inputLabel}>修改原因（可选）</Text>
              <TextInput
                style={styles.reasonInput}
                value={newProposalReason}
                onChangeText={setNewProposalReason}
                placeholder="说明为什么需要这个修改..."
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />
              
              <Text style={styles.proposalNote}>
                提交后，您的修改建议将由社区投票决定是否采纳。
                获得3票赞同后自动通过，3票反对则拒绝。
                高信誉用户的建议会自动通过。
              </Text>
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  content: {
    paddingBottom: 40,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  errorText: {
    fontSize: 16,
    color: '#6b7280',
  },
  backLink: {
    color: '#2563eb',
    fontSize: 16,
  },
  header: {
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  backBtn: {
    padding: 4,
  },
  backText: {
    fontSize: 16,
    color: '#2563eb',
  },
  main: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    borderRadius: 12,
    padding: 20,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  courseBadge: {
    backgroundColor: '#e0e7ff',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  courseText: {
    color: '#4338ca',
    fontSize: 13,
    fontWeight: '600',
  },
  verifiedSmall: {
    fontSize: 12,
    color: '#16a34a',
    fontWeight: '500',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1f2937',
    marginBottom: 12,
  },
  dueRow: {
    marginBottom: 12,
  },
  dueTime: {
    fontSize: 15,
    color: '#4b5563',
    marginBottom: 4,
  },
  remaining: {
    fontSize: 14,
    fontWeight: '600',
    color: '#059669',
  },
  overdue: {
    color: '#dc2626',
  },
  descSection: {
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
    paddingTop: 16,
    marginTop: 4,
    marginBottom: 12,
  },
  descHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  descLabel: {
    fontSize: 12,
    color: '#6b7280',
  },
  proposeLink: {
    fontSize: 13,
    color: '#2563eb',
  },
  noDescText: {
    fontSize: 14,
    color: '#9ca3af',
    marginBottom: 8,
  },
  addDescBtn: {
    marginTop: 4,
  },
  description: {
    fontSize: 15,
    lineHeight: 22,
    color: '#374151',
  },
  meta: {
    fontSize: 13,
    color: '#9ca3af',
  },
  // Note section
  noteSection: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 12,
    padding: 16,
  },
  noteTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  noteTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1f2937',
  },
  editLink: {
    fontSize: 14,
    color: '#2563eb',
  },
  noteContent: {
    fontSize: 14,
    color: '#6b7280',
    lineHeight: 20,
  },
  noteHint: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 8,
  },
  noteEditArea: {
    gap: 12,
  },
  noteInput: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    minHeight: 80,
    backgroundColor: '#f9fafb',
  },
  noteActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  noteCancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  noteCancelText: {
    color: '#6b7280',
    fontSize: 14,
  },
  noteSaveBtn: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  noteSaveText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  btnDisabled: {
    opacity: 0.6,
  },
  // Vote section
  voteSection: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
  },
  voteQuestion: {
    fontSize: 15,
    fontWeight: '600',
    color: '#4b5563',
    marginBottom: 16,
  },
  voteButtons: {
    flexDirection: 'row',
    gap: 20,
  },
  voteBtn: {
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#f3f4f6',
    minWidth: 80,
  },
  votedUp: {
    backgroundColor: '#dbeafe',
  },
  votedDown: {
    backgroundColor: '#fee2e2',
  },
  voteEmoji: {
    fontSize: 24,
    marginBottom: 4,
  },
  voteCount: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1f2937',
  },
  // Modal styles
  modalContainer: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    backgroundColor: '#fff',
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#1f2937',
  },
  closeText: {
    fontSize: 16,
    color: '#2563eb',
  },
  cancelText: {
    fontSize: 16,
    color: '#6b7280',
  },
  submitText: {
    fontSize: 16,
    color: '#2563eb',
    fontWeight: '600',
  },
  submitDisabled: {
    color: '#9ca3af',
  },
  modalContent: {
    flex: 1,
    padding: 16,
  },
  newProposalBtn: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderStyle: 'dashed',
  },
  newProposalText: {
    color: '#2563eb',
    fontSize: 15,
    fontWeight: '500',
  },
  emptyText: {
    textAlign: 'center',
    color: '#9ca3af',
    fontSize: 15,
    marginTop: 40,
  },
  proposalCard: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  proposalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  proposerName: {
    fontSize: 14,
    color: '#4b5563',
    fontWeight: '500',
  },
  proposalStatus: {
    fontSize: 12,
    color: '#f59e0b',
    fontWeight: '500',
  },
  statusApproved: {
    color: '#16a34a',
  },
  statusRejected: {
    color: '#dc2626',
  },
  proposalDesc: {
    fontSize: 14,
    color: '#374151',
    lineHeight: 20,
    marginBottom: 8,
  },
  proposalReason: {
    fontSize: 13,
    color: '#6b7280',
    fontStyle: 'italic',
    marginBottom: 8,
  },
  proposalVotes: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
  },
  pVoteBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#f3f4f6',
  },
  pVotedUp: {
    backgroundColor: '#dbeafe',
  },
  pVotedDown: {
    backgroundColor: '#fee2e2',
  },
  voteHint: {
    fontSize: 12,
    color: '#9ca3af',
    marginLeft: 'auto',
  },
  // New proposal form
  inputLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#374151',
    marginBottom: 8,
    marginTop: 16,
  },
  proposalInput: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    minHeight: 150,
  },
  reasonInput: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    minHeight: 80,
  },
  proposalNote: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 16,
    lineHeight: 18,
  },
});
