// @generated by protoc-gen-es v2.0.0 with parameter "target=ts"
// @generated from file dwango/nicolive/chat/data/state.proto (package dwango.nicolive.chat.data, syntax proto3)
/* eslint-disable */

import type { GenFile, GenMessage } from "@bufbuild/protobuf/codegenv1";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv1";
import type { CommentLock, CommentMode, Enquete, Marquee, MoveOrder, ProgramStatus, Statistics, TrialPanel } from "./atoms_pb";
import { file_dwango_nicolive_chat_data_atoms } from "./atoms_pb";
import type { ModerationAnnouncement } from "./atoms/moderator_pb";
import { file_dwango_nicolive_chat_data_atoms_moderator } from "./atoms/moderator_pb";
import type { Message } from "@bufbuild/protobuf";

/**
 * Describes the file dwango/nicolive/chat/data/state.proto.
 */
export const file_dwango_nicolive_chat_data_state: GenFile = /*@__PURE__*/
  fileDesc("CiVkd2FuZ28vbmljb2xpdmUvY2hhdC9kYXRhL3N0YXRlLnByb3RvEhlkd2FuZ28ubmljb2xpdmUuY2hhdC5kYXRhIoYGCg1OaWNvbGl2ZVN0YXRlEj4KCnN0YXRpc3RpY3MYASABKAsyJS5kd2FuZ28ubmljb2xpdmUuY2hhdC5kYXRhLlN0YXRpc3RpY3NIAIgBARI4CgdlbnF1ZXRlGAIgASgLMiIuZHdhbmdvLm5pY29saXZlLmNoYXQuZGF0YS5FbnF1ZXRlSAGIAQESPQoKbW92ZV9vcmRlchgDIAEoCzIkLmR3YW5nby5uaWNvbGl2ZS5jaGF0LmRhdGEuTW92ZU9yZGVySAKIAQESOAoHbWFycXVlZRgEIAEoCzIiLmR3YW5nby5uaWNvbGl2ZS5jaGF0LmRhdGEuTWFycXVlZUgDiAEBEkEKDGNvbW1lbnRfbG9jaxgFIAEoCzImLmR3YW5nby5uaWNvbGl2ZS5jaGF0LmRhdGEuQ29tbWVudExvY2tIBIgBARJBCgxjb21tZW50X21vZGUYBiABKAsyJi5kd2FuZ28ubmljb2xpdmUuY2hhdC5kYXRhLkNvbW1lbnRNb2RlSAWIAQESPwoLdHJpYWxfcGFuZWwYByABKAsyJS5kd2FuZ28ubmljb2xpdmUuY2hhdC5kYXRhLlRyaWFsUGFuZWxIBogBARJFCg5wcm9ncmFtX3N0YXR1cxgJIAEoCzIoLmR3YW5nby5uaWNvbGl2ZS5jaGF0LmRhdGEuUHJvZ3JhbVN0YXR1c0gHiAEBEl0KF21vZGVyYXRpb25fYW5ub3VuY2VtZW50GAogASgLMjcuZHdhbmdvLm5pY29saXZlLmNoYXQuZGF0YS5hdG9tcy5Nb2RlcmF0aW9uQW5ub3VuY2VtZW50SAiIAQFCDQoLX3N0YXRpc3RpY3NCCgoIX2VucXVldGVCDQoLX21vdmVfb3JkZXJCCgoIX21hcnF1ZWVCDwoNX2NvbW1lbnRfbG9ja0IPCg1fY29tbWVudF9tb2RlQg4KDF90cmlhbF9wYW5lbEIRCg9fcHJvZ3JhbV9zdGF0dXNCGgoYX21vZGVyYXRpb25fYW5ub3VuY2VtZW50YgZwcm90bzM", [file_dwango_nicolive_chat_data_atoms, file_dwango_nicolive_chat_data_atoms_moderator]);

/**
 * @generated from message dwango.nicolive.chat.data.NicoliveState
 */
export type NicoliveState = Message<"dwango.nicolive.chat.data.NicoliveState"> & {
  /**
   * @generated from field: optional dwango.nicolive.chat.data.Statistics statistics = 1;
   */
  statistics?: Statistics;

  /**
   * @generated from field: optional dwango.nicolive.chat.data.Enquete enquete = 2;
   */
  enquete?: Enquete;

  /**
   * @generated from field: optional dwango.nicolive.chat.data.MoveOrder move_order = 3;
   */
  moveOrder?: MoveOrder;

  /**
   * @generated from field: optional dwango.nicolive.chat.data.Marquee marquee = 4;
   */
  marquee?: Marquee;

  /**
   * @generated from field: optional dwango.nicolive.chat.data.CommentLock comment_lock = 5;
   */
  commentLock?: CommentLock;

  /**
   * @generated from field: optional dwango.nicolive.chat.data.CommentMode comment_mode = 6;
   */
  commentMode?: CommentMode;

  /**
   * @generated from field: optional dwango.nicolive.chat.data.TrialPanel trial_panel = 7;
   */
  trialPanel?: TrialPanel;

  /**
   * @generated from field: optional dwango.nicolive.chat.data.ProgramStatus program_status = 9;
   */
  programStatus?: ProgramStatus;

  /**
   * @generated from field: optional dwango.nicolive.chat.data.atoms.ModerationAnnouncement moderation_announcement = 10;
   */
  moderationAnnouncement?: ModerationAnnouncement;
};

/**
 * Describes the message dwango.nicolive.chat.data.NicoliveState.
 * Use `create(NicoliveStateSchema)` to create a new message.
 */
export const NicoliveStateSchema: GenMessage<NicoliveState> = /*@__PURE__*/
  messageDesc(file_dwango_nicolive_chat_data_state, 0);

