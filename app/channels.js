export function createChannelAdapter({ api }) {
  return {
    async handleMessage({ channel, senderId, text }) {
      const conversationId = `channel:${channel}:${senderId}`;
      let conversation = api.listConversations().find(item => item.id === conversationId);
      if (!conversation) conversation = api.createConversation(`${channel} · ${senderId}`, conversationId);
      return api.sendMessage(conversation.id, text);
    },
  };
}
