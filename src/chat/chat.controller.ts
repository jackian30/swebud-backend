import { Body, Controller, Delete, Get, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { UuidParam } from '../common/uuid-param.decorator';
import { AddBuddyGroupParticipantsDto, ChatHistoryQueryDto, ChatMessageSearchQueryDto, ChatMuteDto, ChatPinDto, CreateBuddyGroupChatDto, MessageReactionDto, MessageReactionQueryDto, RegisterChatKeyDto, ReportMessageDto, SendBuddyGroupMessageDto, SendDirectMessageDto, UpdateChatProfileDto } from './dto';

@UseGuards(JwtAuthGuard)
@Controller('chat')
export class ChatController {
  constructor(private chat: ChatService, private gateway: ChatGateway) {}
  @Get('keys/me') myKey(@CurrentUser() user: AuthUser) { return this.chat.myKey(user.id); }
  @Post('keys') registerKey(@CurrentUser() user: AuthUser, @Body() dto: RegisterChatKeyDto) { return this.chat.registerKey(user.id, dto); }
  @Get('keys/:peerId') peerKey(@CurrentUser() user: AuthUser, @UuidParam('peerId') peerId: string) { return this.chat.peerKey(user.id, peerId); }
  @Get('profiles/buddy/:peerId') buddyProfile(@CurrentUser() user: AuthUser, @UuidParam('peerId') peerId: string) { return this.chat.buddyProfile(user.id, peerId); }
  @Patch('profiles/buddy/:peerId') updateBuddyProfile(@CurrentUser() user: AuthUser, @UuidParam('peerId') peerId: string, @Body() dto: UpdateChatProfileDto) { return this.chat.updateBuddyProfile(user.id, peerId, dto); }
  @Get('search/messages') searchMessages(@CurrentUser() user: AuthUser, @Query() query: ChatMessageSearchQueryDto) { return this.chat.searchMessages(user.id, query.q); }
  @Patch('conversations/:peerId/mute') muteConversation(@CurrentUser() user: AuthUser, @UuidParam('peerId') peerId: string, @Body() dto: ChatMuteDto) { return this.chat.setDirectMute(user.id, peerId, dto); }
  @Patch('conversations/:peerId/pin') pinConversation(@CurrentUser() user: AuthUser, @UuidParam('peerId') peerId: string, @Body() dto: ChatPinDto) { return this.chat.setDirectPin(user.id, peerId, dto); }
  @Post('messages') async send(@CurrentUser() user: AuthUser, @Body() dto: SendDirectMessageDto) { const message = await this.chat.send(user.id, dto); this.gateway.emitMessage(dto.recipientId, 'chat:message', message); this.gateway.emitMessage(user.id, 'chat:message', message); return message; }
  @Post('messages/:id/reactions') async react(@CurrentUser() user: AuthUser, @UuidParam('id') id: string, @Body() dto: MessageReactionDto) { const message = await this.chat.react(user.id, id, dto); if (message.recipientId) this.gateway.emitMessage(message.recipientId, 'chat:message', message); this.gateway.emitMessage(message.senderId, 'chat:message', message); return message; }
  @Get('messages/:id/info') messageInfo(@CurrentUser() user: AuthUser, @UuidParam('id') id: string) { return this.chat.messageInfo(user.id, id); }
  @Patch('messages/:id/pin') pinMessage(@CurrentUser() user: AuthUser, @UuidParam('id') id: string, @Body() dto: ChatPinDto) { return this.chat.setMessagePin(user.id, id, dto); }
  @Post('messages/:id/report') reportMessage(@CurrentUser() user: AuthUser, @UuidParam('id') id: string, @Body() dto: ReportMessageDto) { return this.chat.reportMessage(user.id, id, dto); }
  @Delete('messages/:id/reactions') async unreact(@CurrentUser() user: AuthUser, @UuidParam('id') id: string, @Query() query: MessageReactionQueryDto) { const message = await this.chat.unreact(user.id, id, query.emoji); if (message.recipientId) this.gateway.emitMessage(message.recipientId, 'chat:message', message); this.gateway.emitMessage(message.senderId, 'chat:message', message); return message; }
  @Post('messages/:id/unsend') async unsendMessage(@CurrentUser() user: AuthUser, @UuidParam('id') id: string) {
    const message = await this.chat.unsendMessage(user.id, id);
    if (message.buddyGroupChatId) {
      const room = await this.chat.buddyGroupChat(user.id, message.buddyGroupChatId);
      for (const member of room.members ?? []) this.gateway.emitMessage(member.userId, 'chat:buddy-group-message', message);
      return message;
    }
    if (message.recipientId) this.gateway.emitMessage(message.recipientId, 'chat:message', message);
    this.gateway.emitMessage(message.senderId, 'chat:message', message);
    return message;
  }
  @Delete('messages/:id') deleteMessage(@CurrentUser() user: AuthUser, @UuidParam('id') id: string) { return this.chat.deleteForMe(user.id, id); }
  @Post('requests') async request(@CurrentUser() user: AuthUser, @Body() dto: SendDirectMessageDto) { const request = await this.chat.request(user.id, dto); this.gateway.emitMessage(request.recipientId ?? dto.recipientId, 'chat:request', request); this.gateway.emitMessage(request.senderId, 'chat:request', request); return request; }
  @Get('requests') requests(@CurrentUser() user: AuthUser) { return this.chat.requests(user.id); }
  @Patch('requests/:id/accept') async accept(@CurrentUser() user: AuthUser, @UuidParam('id') id: string) { const request = await this.chat.accept(user.id, id); this.gateway.emitMessage(request.senderId, 'chat:request-updated', request); this.gateway.emitMessage(user.id, 'chat:request-updated', request); return request; }
  @Patch('requests/:id/decline') decline(@CurrentUser() user: AuthUser, @UuidParam('id') id: string) { return this.chat.decline(user.id, id); }
  @Get('buddy-groups') buddyGroupChats(@CurrentUser() user: AuthUser) { return this.chat.buddyGroupChats(user.id); }
  @Post('buddy-groups') async createBuddyGroupChat(@CurrentUser() user: AuthUser, @Body() dto: CreateBuddyGroupChatDto) {
    const room = await this.chat.createBuddyGroupChat(user.id, dto);
    for (const member of room.members ?? []) this.gateway.emitMessage(member.userId, 'chat:buddy-group-updated', room);
    return room;
  }
  @Get('buddy-groups/:id') buddyGroupChat(@CurrentUser() user: AuthUser, @UuidParam('id') id: string) { return this.chat.buddyGroupChat(user.id, id); }
  @Patch('buddy-groups/:id/mute') muteBuddyGroupChat(@CurrentUser() user: AuthUser, @UuidParam('id') id: string, @Body() dto: ChatMuteDto) { return this.chat.setBuddyGroupMute(user.id, id, dto); }
  @Patch('buddy-groups/:id/pin') pinBuddyGroupChat(@CurrentUser() user: AuthUser, @UuidParam('id') id: string, @Body() dto: ChatPinDto) { return this.chat.setBuddyGroupPin(user.id, id, dto); }
  @Post('buddy-groups/:id/participants') async addBuddyGroupParticipants(@CurrentUser() user: AuthUser, @UuidParam('id') id: string, @Body() dto: AddBuddyGroupParticipantsDto) {
    const room = await this.chat.addBuddyGroupParticipants(user.id, id, dto);
    for (const member of room.members ?? []) this.gateway.emitMessage(member.userId, 'chat:buddy-group-updated', room);
    return room;
  }
  @Get('buddy-groups/:id/messages') buddyGroupMessages(@CurrentUser() user: AuthUser, @UuidParam('id') id: string, @Query() query: ChatHistoryQueryDto) { return this.chat.buddyGroupMessages(user.id, id, query); }
  @Patch('buddy-groups/:id/read') markBuddyGroupRead(@CurrentUser() user: AuthUser, @UuidParam('id') id: string) { return this.chat.markBuddyGroupRead(user.id, id); }
  @Post('buddy-groups/:id/messages') async sendBuddyGroupMessage(@CurrentUser() user: AuthUser, @UuidParam('id') id: string, @Body() dto: SendBuddyGroupMessageDto) {
    const message = await this.chat.sendBuddyGroupMessage(user.id, id, dto);
    const room = await this.chat.buddyGroupChat(user.id, id);
    for (const member of room.members ?? []) this.gateway.emitMessage(member.userId, 'chat:buddy-group-message', message);
    return message;
  }
  @Get('conversations') conversations(@CurrentUser() user: AuthUser) { return this.chat.conversations(user.id); }
  @Get('conversations/:peerId') conversation(@CurrentUser() user: AuthUser, @UuidParam('peerId') peerId: string, @Query() query: ChatHistoryQueryDto) { return this.chat.conversation(user.id, peerId, query); }
  @Get('unread-count') unreadCount(@CurrentUser() user: AuthUser) { return this.chat.unreadCount(user.id); }
  @Patch('conversations/:peerId/read') async markRead(@CurrentUser() user: AuthUser, @UuidParam('peerId') peerId: string) {
    const result = await this.chat.markRead(user.id, peerId);
    if (result.readCount > 0) {
      this.gateway.emitMessage(peerId, 'chat:read', { readerId: user.id, peerId, readAt: result.readAt });
      this.gateway.emitMessage(user.id, 'chat:read', { readerId: user.id, peerId, readAt: result.readAt });
    }
    return result;
  }
}
