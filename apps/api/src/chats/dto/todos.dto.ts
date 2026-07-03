import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

import {
  TODO_CONTENT_MAX,
  todoSource,
  todoStatus,
  type Todo,
} from '../../db/schema';
import { type TodoStatus } from '../todos-repository';

export class CreateTodoDto {
  @ApiProperty({ minLength: 1, maxLength: TODO_CONTENT_MAX })
  @IsString()
  @MinLength(1)
  @MaxLength(TODO_CONTENT_MAX)
  content!: string;
}

export class UpdateTodoDto {
  @ApiProperty({ enum: todoStatus.enumValues })
  @IsIn(todoStatus.enumValues)
  status!: TodoStatus;
}

export class TodoResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ maxLength: TODO_CONTENT_MAX })
  content!: string;

  @ApiProperty({ enum: todoStatus.enumValues })
  status!: TodoStatus;

  @ApiProperty({
    enum: todoSource.enumValues,
    description:
      "'user' (added in the panel) or 'agent' (the assistant's plan).",
  })
  source!: (typeof todoSource.enumValues)[number];

  @ApiProperty({ type: 'integer' })
  position!: number;
}

export function toTodoResponse(todo: Todo): TodoResponse {
  return {
    id: todo.id,
    content: todo.content,
    status: todo.status,
    source: todo.source,
    position: todo.position,
  };
}
