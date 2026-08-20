from tui_gateway.channels import ChannelManager, ChannelType, ModeType


def test_channel_creation_and_membership():
    mgr = ChannelManager()
    ch = mgr.create_direct_channel(bot_id="ops", profile="ops")
    assert ch.channel_type == ChannelType.DIRECT
    assert ch.primary_profile == "ops"
    group = mgr.create_group_channel(name="Infra Squad", member_profiles=["ops", "researcher"])
    assert group.channel_type == ChannelType.GROUP
    assert "ops" in group.member_profiles
    assert "researcher" in group.member_profiles
