from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration, loaded from environment / .env."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Backend to which we emit signed proctor events.
    api_base_url: str = "http://localhost:4000"
    proctor_webhook_secret: str = "change-me-proctor-secret"

    # Which detectors are enabled. When a real model backend isn't installed we
    # fall back to lightweight heuristics so the service always runs.
    enable_vision: bool = True
    enable_audio: bool = True

    # Detection thresholds (tunable without code changes).
    face_confidence: float = 0.5
    object_confidence: float = 0.45

    log_level: str = "info"


settings = Settings()
