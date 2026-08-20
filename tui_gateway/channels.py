from dataclasses import dataclass, field
from enum import Enum
import uuid
from typing import Optional, List, Dict


class ChannelType(str, Enum):
    DIRECT = "direct"
    GROUP = "group"


class ModeType(str, Enum):
    NORMAL = "normal"
    DEEP_RESEARCH = "deep_research"
    CODE = "code"
    PLAN = "plan"


@dataclass
class Channel:
    channel_id: str
    channel_type: ChannelType
    name: str
    primary_profile: str
    member_profiles: List[str] = field(default_factory=list)
    session_map: Dict[str, str] = field(default_factory=dict)
    active_mode: ModeType = ModeType.NORMAL


class ChannelManager:
    def __init__(self):
        self._channels: Dict[str, Channel] = {}

    def create_direct_channel(self, bot_id: str, profile: str) -> Channel:
        cid = f"dm_{bot_id}_{uuid.uuid4().hex[:8]}"
        ch = Channel(
            channel_id=cid,
            channel_type=ChannelType.DIRECT,
            name=bot_id,
            primary_profile=profile,
            member_profiles=[profile],
        )
        self._channels[cid] = ch
        return ch

    def create_group_channel(self, name: str, member_profiles: List[str]) -> Channel:
        cid = f"grp_{uuid.uuid4().hex[:8]}"
        ch = Channel(
            channel_id=cid,
            channel_type=ChannelType.GROUP,
            name=name,
            primary_profile=member_profiles[0] if member_profiles else "default",
            member_profiles=member_profiles,
        )
        self._channels[cid] = ch
        return ch

    def get_channel(self, cid: str) -> Optional[Channel]:
        return self._channels.get(cid)
