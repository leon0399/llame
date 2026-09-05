import { ChatsModule } from '../chats/chats.module';
import { NodeRunsController } from './node-runs.controller';
import { Module } from '@nestjs/common';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { InstanceConfigModule } from '../instance-config/instance-config.module';
import { HostedNodeAccess } from './hosted-node-access';
import { NodeController } from './node.controller';

@Module({ imports: [KnowledgeModule, InstanceConfigModule, ChatsModule], controllers: [NodeController, NodeRunsController], providers: [HostedNodeAccess] })
export class NodeModule {}
