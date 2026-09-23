from pathlib import Path

from pydantic import AnyHttpUrl, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parent.parent / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
        hide_input_in_errors=True,
    )

    ekt_api_base_url: AnyHttpUrl = "https://ekt.kz/api"
    ekt_api_username: SecretStr = SecretStr("")
    ekt_api_password: SecretStr = SecretStr("")
    catalog_db_path: Path = Path(__file__).resolve().parent.parent / "data" / "catalog.sqlite3"

    @field_validator("ekt_api_base_url")
    @classmethod
    def validate_base_url(cls, value: AnyHttpUrl) -> AnyHttpUrl:
        if value.scheme != "https" or value.username or value.password:
            raise ValueError("EKT_API_BASE_URL must use HTTPS without credentials")
        if value.query or value.fragment:
            raise ValueError("EKT_API_BASE_URL must not contain a query or fragment")
        return value
