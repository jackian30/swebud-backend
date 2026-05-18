import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { AddBuddyGroupParticipantsDto, CreateBuddyGroupChatDto, MessageReactionDto, RegisterChatKeyDto, SendBuddyGroupMessageDto, SendDirectMessageDto, UpdateChatProfileDto } from './dto';

@UseGuards(JwtAuthGuard)
@Controller('chat')
export class ChatController {
  constructor(private chat: ChatService, private gateway: ChatGateway) {}
  @Get('keys/me') myKey(@CurrentUser() user: AuthUser) { return this.chat.myKey(user.id); }
  @Post('keys') registerKey(@CurrentUser() user: AuthUser, @Body() dto: RegisterChatKeyDto) { return this.chat.registerKey(user.id, dto); }
  @Get('keys/:peerId') peerKey(@Param('peerId') peerId: string) { return this.chat.peerKey(peerId); }
  @Get('profiles/buddy/:peerId') buddyProfile(@CurrentUser() user: AuthUser, @Param('peerId') peerId: string) { return this.chat.buddyProfile(user.id, peerId); }
  @Patch('profiles/buddy/:peerId') updateBuddyProfile(@CurrentUser() user: AuthUser, @Param('peerId') peerId: string, @Body() dto: UpdateChatProfileDto) { return this.chat.updateBuddyProfile(user.id, peerId, dto); }
  @Post('messages') async send(@CurrentUser() user: AuthUser, @Body() dto: SendDirectMessageDto) { const message = await this.chat.send(user.id, dto); this.gateway.emitMessage(dto.recipientId, 'chat:message', message); this.gateway.emitMessage(user.id, 'chat:message', message); return message; }
  @Post('messages/:id/reactions') async react(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: MessageReactionDto) { const message = await this.chat.react(user.id, id, dto); if (message.recipientId) this.gateway.emitMessage(message.recipientId, 'chat:message', message); this.gateway.emitMessage(message.senderId, 'chat:message', message); return message; }
  @Delete('messages/:id/reactions') async unreact(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('emoji') emoji: string) { const message = await this.chat.unreact(user.id, id, emoji); if (message.recipientId) this.gateway.emitMessage(message.recipientId, 'chat:message', message); this.gateway.emitMessage(message.senderId, 'chat:message', message); return message; }
  @Delete('messages/:id') async deleteMessage(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const message = await this.chat.deleteMessage(user.id, id);
    if (message.buddyGroupChatId) {
      const room = await this.chat.buddyGroupChat(user.id, message.buddyGroupChatId);
      for (const member of room.members ?? []) this.gateway.emitMessage(member.userId, 'chat:buddy-group-message', message);
      return message;
    }
    if (message.recipientId) this.gateway.emitMessage(message.recipientId, 'chat:message', message);
    this.gateway.emitMessage(message.senderId, 'chat:message', message);
    return message;
  }
  @Post('requests') async request(@CurrentUser() user: AuthUser, @Body() dto: SendDirectMessageDto) { const request = await this.chat.request(user.id, dto); this.gateway.emitMessage(dto.recipientId, 'chat:request', request); return request; }
  @Get('requests') requests(@CurrentUser() user: AuthUser) { return this.chat.requests(user.id); }
  @Patch('requests/:id/accept') async accept(@CurrentUser() user: AuthUser, @Param('id') id: string) { const request = await this.chat.accept(user.id, id); this.gateway.emitMessage(request.senderId, 'chat:request-updated', request); this.gateway.emitMessage(user.id, 'chat:request-updated', request); return request; }
  @Patch('requests/:id/decline') decline(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.chat.decline(user.id, id); }
  @Get('buddy-groups') buddyGroupChats(@CurrentUser() user: AuthUser) { return this.chat.buddyGroupChats(user.id); }
  @Post('buddy-groups') async createBuddyGroupChat(@CurrentUser() user: AuthUser, @Body() dto: CreateBuddyGroupChatDto) {
    const room = await this.chat.createBuddyGroupChat(user.id, dto);
    for (const member of room.members ?? []) this.gateway.emitMessage(member.userId, 'chat:buddy-group-updated', room);
    return room;
  }
  @Get('buddy-groups/:id') buddyGroupChat(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.chat.buddyGroupChat(user.id, id); }
  @Post('buddy-groups/:id/participants') async addBuddyGroupParticipants(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AddBuddyGroupParticipantsDto) {
    const room = await this.chat.addBuddyGroupParticipants(user.id, id, dto);
    for (const member of room.members ?? []) this.gateway.emitMessage(member.userId, 'chat:buddy-group-updated', room);
    return room;
  }
  @Get('buddy-groups/:id/messages') buddyGroupMessages(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.chat.buddyGroupMessages(user.id, id); }
  @Post('buddy-groups/:id/messages') async sendBuddyGroupMessage(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SendBuddyGroupMessageDto) {
    const message = await this.chat.sendBuddyGroupMessage(user.id, id, dto);
    const room = await this.chat.buddyGroupChat(user.id, id);
    for (const member of room.members ?? []) this.gateway.emitMessage(member.userId, 'chat:buddy-group-message', message);
    return message;
  }
  @Get('conversations') conversations(@CurrentUser() user: AuthUser) { return this.chat.conversations(user.id); }
  @Get('conversations/:peerId') conversation(@CurrentUser() user: AuthUser, @Param('peerId') peerId: string) { return this.chat.conversation(user.id, peerId); }
  @Get('unread-count') unreadCount(@CurrentUser() user: AuthUser) { return this.chat.unreadCount(user.id); }
  @Patch('conversations/:peerId/read') markRead(@CurrentUser() user: AuthUser, @Param('peerId') peerId: string) { return this.chat.markRead(user.id, peerId); }
}
