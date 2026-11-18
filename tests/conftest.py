import socket

import pytest


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    """Every offline test fails loudly if anything tries to open a connection."""
    def refuse(*args, **kwargs):
        raise RuntimeError("network access is disabled in offline tests")
    monkeypatch.setattr(socket.socket, "connect", refuse)
